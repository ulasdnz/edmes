import { CustomError } from '@mes/core'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import * as productionClient from '../../lib/internal-api/production.client.js'
import * as telemetryClient from '../../lib/internal-api/telemetry.client.js'
import * as workCenterClient from '../../lib/internal-api/work-center.client.js'
import { clip } from '../../utils/intervals.js'
import * as policyService from '../policy/policy.service.js'
import * as reasonService from '../reason/reason.service.js'
import type { AvailabilityResult, AvailabilityStatus } from './availability.calc.js'
import { calculateAvailability } from './availability.calc.js'
import type { Diagnostic } from './diagnostics.js'
import { normalize } from './interval-normalizer.js'
import * as oeeRepository from './oee.repository.js'
import type { OeeRange } from './oee.types.js'
import type { ProductivityResult, ProductivityStatus } from './productivity.calc.js'
import {
  calculateProductivity,
  countedOutput,
  speedOutput,
  splitAtStandards,
} from './productivity.calc.js'
import type { QualityResult, QualityStatus } from './quality.calc.js'
import { calculateQuality } from './quality.calc.js'
import { calculateVirtualOee } from './virtual-work-center.js'

export type OeeInput = {
  workCenterId: string
  range: OeeRange
}

export type OeeOutput = {
  availability: AvailabilityResult
  productivity: ProductivityResult
  quality: QualityResult
}

// ── Public API types ──────────────────────────────────────────────────────────

type FactorStatus = 'ok' | 'no_context' | 'not_calculable'

type OeeFactorResponse = {
  percentage: number
  status: FactorStatus
  diagnostics: Diagnostic[]
}

type OeeStatus = 'ok' | 'no_context' | 'not_calculable'

export type OeePublicResponse = {
  workCenterId: string
  range: { from: string; to: string }
  availability: OeeFactorResponse
  productivity: OeeFactorResponse
  quality: OeeFactorResponse
  oee: OeeFactorResponse & { status: OeeStatus }
  diagnostics: Diagnostic[]
}

export type CalculateInput = {
  workCenterId: string
  from: Date
  to: Date
  userId: string
  // The caller's visible work centers, from its auth context
  workCenterIds?: string[]
}

function toPercentage(ratio: number): number {
  return Math.round(Math.max(0, ratio) * 100)
}

function resolveOeeStatus(a: FactorStatus, p: FactorStatus, q: FactorStatus): OeeStatus {
  if (a === 'not_calculable' || p === 'not_calculable' || q === 'not_calculable') {
    return 'not_calculable'
  }
  if (a === 'no_context' && p === 'no_context' && q === 'no_context') {
    return 'no_context'
  }
  return 'ok'
}

export async function calculate(input: CalculateInput): Promise<OeePublicResponse> {
  const { workCenterId, from, to, userId, workCenterIds = [] } = input
  const range: OeeRange = { from, to }

  if (userId !== SYSTEM_IDENTITY && !workCenterIds.includes(workCenterId)) {
    throw new CustomError(404, 'error.not_found')
  }

  const wc = await workCenterClient.getById(workCenterId)
  if (!wc) {
    throw new CustomError(404, 'error.not_found')
  }

  if (wc.type === 'virtual') {
    const virtualResult = await calculateVirtualOee(workCenterId, range, async (wcId, r) =>
      calculateOeeInternal(wcId, r, SYSTEM_IDENTITY),
    )

    const aStatus = virtualResult.availability.status
    const pStatus = virtualResult.productivity.status
    const qStatus = virtualResult.quality.status
    const oeeStatus = resolveOeeStatus(aStatus, pStatus, qStatus)

    const oeeRatio =
      oeeStatus === 'ok'
        ? virtualResult.availability.ratio *
          virtualResult.productivity.ratio *
          virtualResult.quality.ratio
        : 0

    return {
      workCenterId,
      range: { from: from.toISOString(), to: to.toISOString() },
      availability: {
        percentage: toPercentage(virtualResult.availability.ratio),
        status: aStatus,
        diagnostics: virtualResult.availability.diagnostics,
      },
      productivity: {
        percentage: toPercentage(virtualResult.productivity.ratio),
        status: pStatus,
        diagnostics: virtualResult.productivity.diagnostics,
      },
      quality: {
        percentage: toPercentage(virtualResult.quality.ratio),
        status: qStatus,
        diagnostics: virtualResult.quality.diagnostics,
      },
      oee: {
        percentage: toPercentage(oeeRatio),
        status: oeeStatus,
        diagnostics: [],
      },
      diagnostics: virtualResult.diagnostics,
    }
  }

  const result = await calculateOee({ workCenterId, range })

  const aStatus = result.availability.status as FactorStatus
  const pStatus = result.productivity.status as FactorStatus
  const qStatus = result.quality.status as FactorStatus
  const oeeStatus = resolveOeeStatus(aStatus, pStatus, qStatus)

  const oeeRatio =
    oeeStatus === 'ok'
      ? result.availability.ratio * result.productivity.ratio * result.quality.ratio
      : 0

  return {
    workCenterId,
    range: { from: from.toISOString(), to: to.toISOString() },
    availability: {
      percentage: toPercentage(result.availability.ratio),
      status: aStatus,
      diagnostics: result.availability.status === 'no_context' ? [] : [],
    },
    productivity: {
      percentage: toPercentage(result.productivity.ratio),
      status: pStatus,
      diagnostics: result.productivity.jobOrders
        .filter(jo => jo.notCalculable)
        .map(() => ({ code: 'no_production_total' as const, severity: 'warning' as const })),
    },
    quality: {
      percentage: toPercentage(result.quality.ratio),
      status: qStatus,
      diagnostics: result.quality.diagnostics,
    },
    oee: {
      percentage: toPercentage(oeeRatio),
      status: oeeStatus,
      diagnostics: [],
    },
    diagnostics: [],
  }
}

async function calculateOeeInternal(
  workCenterId: string,
  range: OeeRange,
  _userId: string,
): Promise<OeeOutput> {
  const wc = await workCenterClient.getById(workCenterId)
  if (wc?.type === 'virtual') {
    const virtualResult = await calculateVirtualOee(workCenterId, range, async (wcId, r) =>
      calculateOeeInternal(wcId, r, SYSTEM_IDENTITY),
    )
    const aStatus = virtualResult.availability.status
    const pStatus = virtualResult.productivity.status
    const qStatus = virtualResult.quality.status
    return {
      availability: {
        status: aStatus,
        ratio: virtualResult.availability.ratio,
        jobOrderTimeMs: 0,
        oeeEligibleTimeMs: 0,
        effectiveRunTimeMs: 0,
        oeeAffectingStopMs: 0,
        nonEffectiveStopMs: 0,
      },
      productivity: {
        status: pStatus,
        ratio: virtualResult.productivity.ratio,
        actualOutput: 0,
        effectiveTargetOutput: 0,
        fullJobTargetOutput: 0,
        quantityAdjustment: 0,
        actualOutputWindowMode: 'execution_span',
        aggregationMode: 'total_ratio',
        jobOrders: [],
      },
      quality: {
        status: qStatus,
        ratio: virtualResult.quality.ratio,
        good: 0,
        total: 0,
        oeeAffectingScrap: 0,
        excludedScrap: 0,
        totalScrap: 0,
        diagnostics: [],
      },
    }
  }
  return calculateOee({ workCenterId, range })
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
    throw new CustomError(400, 'error.virtual_work_center_not_supported_here')
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
      productionCounterTagId: workCenter.tagBindings?.productionCounterTagId,
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
  const productionCounterTagId = workCenter.tagBindings?.productionCounterTagId
  const speedTagId = workCenter.tagBindings?.speedTagId

  // Collect all actual output windows across all JOs (for batch telemetry call), split at
  // standard boundaries so each measurement converts with the standard valid at that time.
  const allActualWindows: Array<{ from: Date; to: Date }> = []
  for (const jw of clippedJobWindows) {
    const standards = productStandardsByJobOrderId[jw.jobOrderId] ?? []
    allActualWindows.push(...splitAtStandards(actualOutputWindowsForJo(jw), standards))
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
    isCountBased && productionCounterTagId && sortedWindows.length > 0
      ? telemetryClient.producedSummary(productionCounterTagId, sortedWindows)
      : Promise.resolve(null),
    !isCountBased && speedTagId && sortedWindows.length > 0
      ? telemetryClient.speedSummary(speedTagId, sortedWindows)
      : Promise.resolve(null),
    reasonService.findExistingIds(allScrapReasonIds),
  ])

  const producedSummaryByTagId: Record<string, typeof producedSummaryResult> = {}
  if (producedSummaryResult && productionCounterTagId) {
    producedSummaryByTagId[productionCounterTagId] = producedSummaryResult
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
    productionCounterTagId,
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
    const joWindows = clippedJobWindows.flatMap(jw =>
      splitAtStandards(
        [{ from: jw.start, to: jw.end }],
        productStandardsByJobOrderId[jw.jobOrderId] ?? [],
      ),
    )

    const [joProducedResult, joSpeedResult] = await Promise.all([
      isCountBased && productionCounterTagId && joWindows.length > 0
        ? telemetryClient.producedSummary(productionCounterTagId, joWindows)
        : Promise.resolve(null),
      !isCountBased && speedTagId && joWindows.length > 0
        ? telemetryClient.speedSummary(speedTagId, joWindows)
        : Promise.resolve(null),
    ])

    // A JO whose standard cannot convert its measurements is already not calculable in
    // productivity, and quality skips it (filtered by !jo.notCalculable), so its 0 is never summed.
    for (const jw of clippedJobWindows) {
      const fullWindow = [{ from: jw.start, to: jw.end }]
      const standards = productStandardsByJobOrderId[jw.jobOrderId] ?? []
      let gross: number | null = 0
      if (joProducedResult) gross = countedOutput(fullWindow, standards, joProducedResult)
      else if (joSpeedResult) gross = speedOutput(fullWindow, standards, joSpeedResult)
      grossProducedPerJo[jw.jobOrderId] = gross ?? 0
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
  }
}
