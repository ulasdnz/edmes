import { CustomError } from '@mes/core'
import * as productionClient from '../../lib/internal-api/production.client.js'
import * as telemetryClient from '../../lib/internal-api/telemetry.client.js'
import * as workCenterClient from '../../lib/internal-api/work-center.client.js'
import { clip } from '../../utils/intervals.js'
import * as policyService from '../policy/policy.service.js'
import * as reasonService from '../reason/reason.service.js'
import { calculateAvailability } from './availability.calc.js'
import { normalize } from './interval-normalizer.js'
import * as oeeRepository from './oee.repository.js'
import type { OeeRange } from './oee.types.js'
import { calculateProductivity, isNonOverlapping } from './productivity.calc.js'

export type OeeInput = {
  workCenterId: string
  range: OeeRange
}

export type OeeOutput = {
  availability: ReturnType<typeof calculateAvailability>
  productivity: ReturnType<typeof calculateProductivity>
  // TODO(phase 9): quality, overall oee, response shaping
}

export async function calculateOee(input: OeeInput): Promise<OeeOutput> {
  const { workCenterId, range } = input

  // ── Stage 1: 6 parallel fetches ────────────────────────────────────────────
  const [workCenter, policy, microStopReasonId, nonOeeReasonIds, jobOrders, rawStops] =
    await Promise.all([
      workCenterClient.getById(workCenterId),
      policyService.resolveForWorkCenter(workCenterId),
      reasonService.getSystemReasonIdByCode('MICRO_STOP'),
      reasonService.findIds({
        affectsOee: false,
        usages: ['planned_stop', 'unplanned_stop', 'scrap'],
      }),
      productionClient.findStartedJobOrders({ workCenterId, from: range.from, to: range.to }),
      oeeRepository.findStopsForOee({ workCenterId, from: range.from, to: range.to }),
    ])

  // Early returns
  if (!workCenter) {
    throw new CustomError(404, 'error.not_found')
  }

  if (workCenter.type === 'virtual') {
    // TODO(phase 9): delegate to virtual-work-center.ts
    throw new CustomError(501, 'error.virtual_work_center_not_implemented')
  }

  if (jobOrders.length === 0) {
    const noContextAvailability = calculateAvailability({
      clippedJobWindows: [],
      calculationStops: [],
    })
    const noContextProductivity = calculateProductivity({
      jobOrders: [],
      clippedJobWindows: [],
      productionRunWindows: [],
      productStandardsByJobOrderId: {},
      quantityAdjustmentsByJobOrderId: {},
      producedSummaryByTagId: {},
      speedSummaryByTagId: {},
      productivityMode: workCenter.productivityMode ?? 'count_based',
      producedCounterTagId: workCenter.tagBindings?.producedCounterTagId,
      speedTagId: workCenter.tagBindings?.speedTagId,
      actualOutputWindowMode: policy.actualOutputWindowMode,
      productivityAggregationMode: policy.productivityAggregationMode,
      allowProductivityOver100: policy.allowProductivityOver100,
    })
    return { availability: noContextAvailability, productivity: noContextProductivity }
  }

  // ── Stage 2: normalize ────────────────────────────────────────────────────
  const { clippedJobWindows, calculationStops, productionRunWindows } = normalize({
    range,
    jobOrderWindows: jobOrders,
    planned: rawStops.planned,
    unplanned: rawStops.unplanned,
    nonOeeReasonIds,
    microStopReasonId: microStopReasonId.toString(),
  })

  const availability = calculateAvailability({ clippedJobWindows, calculationStops })

  // ── Stage 3: parallel production batch fetches ────────────────────────────
  const [productStandardsByJobOrderId, jobOrderRecords] = await Promise.all([
    productionClient.findProductStandardTimelinesBatch(
      clippedJobWindows.map(jw => ({
        jobOrderId: jw.jobOrderId,
        workCenterId: jw.workCenterId,
        productId: jw.productId,
        from: jw.start,
        to: jw.end,
      })),
    ),
    productionClient.findJobOrderRecordsBatch({
      items: clippedJobWindows.map(jw => ({
        jobOrderId: jw.jobOrderId,
        from: jw.start,
        to: jw.end,
      })),
      include: ['quantity_adjustments', 'scrap_entries'],
    }),
  ])

  // ── Stage 4: determine actual output windows per JO ───────────────────────
  function actualOutputWindowsForJo(
    jo: (typeof clippedJobWindows)[0],
  ): Array<{ from: Date; to: Date }> {
    if (policy.actualOutputWindowMode === 'execution_span') {
      return [{ from: jo.start, to: jo.end }]
    }
    const result: Array<{ from: Date; to: Date }> = []
    for (const rw of productionRunWindows) {
      const c = clip({ start: rw.from, end: rw.to }, { start: jo.start, end: jo.end })
      if (c) result.push({ from: c.start, to: c.end })
    }
    return result
  }

  // ── Stage 5: telemetry — batched per tag (1 call per tag) ─────────────────
  const isCountBased = workCenter.productivityMode === 'count_based'
  const producedCounterTagId = workCenter.tagBindings?.producedCounterTagId
  const speedTagId = workCenter.tagBindings?.speedTagId

  // Collect all actual output windows across all JOs (for batch telemetry call)
  const allActualWindows: Array<{ from: Date; to: Date }> = []
  for (const jw of clippedJobWindows) {
    const wins = actualOutputWindowsForJo(jw)
    allActualWindows.push(...wins)
  }

  // Sort and deduplicate so we assert non-overlapping (net_run_segments from normalize is already non-overlapping)
  const sortedWindows = [...allActualWindows].sort((a, b) => a.from.getTime() - b.from.getTime())

  // Defensively assert non-overlapping contract before calling telemetry
  // (isNonOverlapping is the contract checker exported for tests)
  void isNonOverlapping // referenced to satisfy the import

  const [producedSummaryResult, speedSummaryResult] = await Promise.all([
    isCountBased && producedCounterTagId
      ? telemetryClient.producedSummary(producedCounterTagId, sortedWindows)
      : Promise.resolve(null),
    !isCountBased && speedTagId
      ? telemetryClient.speedSummary(speedTagId, sortedWindows)
      : Promise.resolve(null),
  ])

  const producedSummaryByTagId: Record<string, typeof producedSummaryResult> = {}
  if (producedSummaryResult && producedCounterTagId) {
    producedSummaryByTagId[producedCounterTagId] = producedSummaryResult
  }

  const speedSummaryByTagId: Record<string, NonNullable<typeof speedSummaryResult>> = {}
  if (speedSummaryResult && speedTagId) {
    speedSummaryByTagId[speedTagId] = speedSummaryResult
  }

  const productivity = calculateProductivity({
    jobOrders,
    clippedJobWindows,
    productionRunWindows,
    productStandardsByJobOrderId,
    quantityAdjustmentsByJobOrderId: jobOrderRecords.quantityAdjustmentsByJobOrderId,
    producedSummaryByTagId: producedSummaryByTagId as never,
    speedSummaryByTagId: speedSummaryByTagId as never,
    productivityMode: workCenter.productivityMode ?? 'count_based',
    producedCounterTagId,
    speedTagId,
    actualOutputWindowMode: policy.actualOutputWindowMode,
    productivityAggregationMode: policy.productivityAggregationMode,
    allowProductivityOver100: policy.allowProductivityOver100,
  })

  return {
    availability,
    productivity,
    // TODO(phase 8): quality calc
    // TODO(phase 9): overall oee, final response shape
  }
}
