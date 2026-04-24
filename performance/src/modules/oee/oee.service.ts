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
import { calculateProductivity, splitAtBoundaries } from './productivity.calc.js'
import { calculateQuality } from './quality.calc.js'

export type OeeInput = {
  workCenterId: string
  range: OeeRange
}

export type OeeOutput = {
  availability: ReturnType<typeof calculateAvailability>
  productivity: ReturnType<typeof calculateProductivity>
  quality: ReturnType<typeof calculateQuality>
  // TODO(phase 9): overall oee, response shaping
}

export async function calculateOee(input: OeeInput): Promise<OeeOutput> {
  const { workCenterId, range } = input

  // ── Stage 1: 5 parallel fetches ────────────────────────────────────────────
  // microStopReasonId is resolved once inside findStopsForOee and returned via rawStops.microStopReasonId.
  const [workCenter, policy, nonOeeReasonIds, jobOrders, rawStops] = await Promise.all([
    workCenterClient.getById(workCenterId),
    policyService.resolveForWorkCenter(workCenterId),
    reasonService.findIds({
      affectsOee: false,
      usages: ['planned_stop', 'unplanned_stop', 'scrap'],
    }),
    productionClient.findStartedJobOrders({ workCenterId, from: range.from, to: range.to }),
    oeeRepository.findStopsForOee({
      workCenterId,
      from: range.from,
      to: range.to,
      excludeUnplannedSystemReasonCodes: ['MICRO_STOP'],
    }),
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
    const noContextQuality = calculateQuality({
      grossProducedAcrossExecution: 0,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [],
      nonOeeReasonIds: new Set(),
      knownReasonIds: new Set(),
    })
    return {
      availability: noContextAvailability,
      productivity: noContextProductivity,
      quality: noContextQuality,
    }
  }

  // ── Stage 2: normalize ────────────────────────────────────────────────────
  const { clippedJobWindows, calculationStops, productionRunWindows } = normalize({
    range,
    jobOrderWindows: jobOrders,
    planned: rawStops.planned,
    unplanned: rawStops.unplanned,
    nonOeeReasonIds,
    microStopReasonId: rawStops.microStopReasonId,
  })

  const availability = calculateAvailability({ clippedJobWindows, calculationStops })

  // ── Stage 3: parallel production batch fetches ────────────────────────────
  // Telemetry call budget: execution_span → ≤2 calls total; net_run_segments → ≤4 calls total
  // (2 for productivity actualOutput + 2 for quality grossProducedAcrossExecution).
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

  // ── Stage 5: telemetry + known reason ids — all parallel ─────────────────
  const isCountBased = workCenter.productivityMode === 'count_based'
  const producedCounterTagId = workCenter.tagBindings?.producedCounterTagId
  const speedTagId = workCenter.tagBindings?.speedTagId

  // Collect all actual output windows across all JOs (for batch telemetry call)
  const allActualWindows: Array<{ from: Date; to: Date }> = []
  for (const jw of clippedJobWindows) {
    const wins = actualOutputWindowsForJo(jw)
    allActualWindows.push(...wins)
  }

  const sortedWindows = [...allActualWindows].sort((a, b) => a.from.getTime() - b.from.getTime())

  const scrapEntriesByJobOrderId = jobOrderRecords.scrapEntriesByJobOrderId

  const allScrapReasonIds = Array.from(
    new Set(
      Object.values(scrapEntriesByJobOrderId)
        .flat()
        .map(e => e.reasonId)
        .filter((id): id is string => id !== null),
    ),
  )

  const [producedSummaryResult, speedSummaryResult, knownReasonIds] = await Promise.all([
    isCountBased && producedCounterTagId
      ? telemetryClient.producedSummary(producedCounterTagId, sortedWindows)
      : Promise.resolve(null),
    !isCountBased && speedTagId
      ? telemetryClient.speedSummary(speedTagId, sortedWindows)
      : Promise.resolve(null),
    reasonService.findExistingIds(allScrapReasonIds),
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

  // ── Stage 6: gross produced over full JO windows (for quality) ────────────
  // In execution_span mode, actualOutputWindows === jobOrderWindows, so productivity's
  // actualOutput already accounts for the full JO span → derive gross directly.
  // In net_run_segments mode, productivity used only run-segment sub-windows, which exclude
  // time during stops. Quality must reflect the FULL JO window (production during stops still
  // happened and counts toward gross output). Issue one extra telemetry call per tag.
  const grossProducedPerJo: Record<string, number> = {}

  if (policy.actualOutputWindowMode === 'net_run_segments') {
    const joWindowsForTelemetry = clippedJobWindows.map(jw => ({ from: jw.start, to: jw.end }))

    const [joProducedResult, joSpeedResult] = await Promise.all([
      isCountBased && producedCounterTagId
        ? telemetryClient.producedSummary(producedCounterTagId, joWindowsForTelemetry)
        : Promise.resolve(null),
      !isCountBased && speedTagId
        ? telemetryClient.speedSummary(speedTagId, joWindowsForTelemetry)
        : Promise.resolve(null),
    ])

    for (let i = 0; i < clippedJobWindows.length; i++) {
      const jw = clippedJobWindows[i]
      if (joProducedResult) {
        // windows[i] aligns with clippedJobWindows[i]: telemetry preserves input window order
        grossProducedPerJo[jw.jobOrderId] = joProducedResult.windows[i]?.value ?? 0
      } else if (joSpeedResult) {
        const standards = productStandardsByJobOrderId[jw.jobOrderId] ?? []
        const ssw = joSpeedResult.windows[i]
        if (ssw) {
          let speedTotal = 0
          const subWindows = splitAtBoundaries(jw.start, jw.end, standards)
          for (const sub of subWindows) {
            const sswFrom = new Date(ssw.from).getTime()
            const sswTo = new Date(ssw.to).getTime()
            const overlapStart = Math.max(sswFrom, sub.start.getTime())
            const overlapEnd = Math.min(sswTo, sub.end.getTime())
            if (overlapEnd > overlapStart) {
              const fraction = (overlapEnd - overlapStart) / (sswTo - sswFrom)
              // counterMultiplier ?? 1: null means no unit conversion, treat as 1
              speedTotal +=
                (ssw.valueArea * fraction * (sub.standard.counterMultiplier ?? 1)) / 60000
            }
          }
          grossProducedPerJo[jw.jobOrderId] = speedTotal
        } else {
          grossProducedPerJo[jw.jobOrderId] = 0
        }
      } else {
        grossProducedPerJo[jw.jobOrderId] = 0
      }
    }
  } else {
    for (const jo of productivity.jobOrders) {
      if (!jo.notCalculable) {
        grossProducedPerJo[jo.jobOrderId] = jo.actualOutput - jo.quantityAdjustment
      }
    }
  }

  // ── Stage 7: quality ──────────────────────────────────────────────────────
  const scrapEntriesByJo = clippedJobWindows.map(jw => {
    const entries = (scrapEntriesByJobOrderId[jw.jobOrderId] ?? []).map(e => ({
      amount: e.amount,
      reasonId: e.reasonId,
      startTime: new Date(e.startTime),
      endTime: new Date(e.endTime),
    }))
    return { clippedJobOrderWindow: { start: jw.start, end: jw.end }, entries }
  })

  let grossProducedAcrossExecution = 0
  let quantityAdjustmentSum = 0
  for (const jo of productivity.jobOrders) {
    if (!jo.notCalculable) {
      grossProducedAcrossExecution += grossProducedPerJo[jo.jobOrderId] ?? 0
      quantityAdjustmentSum += jo.quantityAdjustment
    }
  }

  const quality = calculateQuality({
    grossProducedAcrossExecution,
    quantityAdjustmentSum,
    scrapEntriesByJobOrder: scrapEntriesByJo,
    nonOeeReasonIds,
    knownReasonIds,
  })

  return {
    availability,
    productivity,
    quality,
    // TODO(phase 9): overall oee, final response shape
  }
}
