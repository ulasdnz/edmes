import type { ProductStandardTimeline } from '../../lib/internal-api/production.client.js'
import type { ProducedSummary, SpeedSummary } from '../../lib/internal-api/telemetry.client.js'
import { clip } from '../../utils/intervals.js'
import type { JobWindow, OeeRange } from './oee.types.js'

export type ProductivityStatus = 'ok' | 'no_context' | 'not_calculable'

export type JobOrderProductivityBreakdown = {
  jobOrderId: string
  productId: string
  ratio: number
  actualOutput: number
  effectiveTargetOutput: number
  fullJobTargetOutput: number
  quantityAdjustment: number
  productionRunMs: number
  notCalculable: boolean
}

export type ProductivityResult = {
  status: ProductivityStatus
  ratio: number
  actualOutput: number
  effectiveTargetOutput: number
  fullJobTargetOutput: number
  quantityAdjustment: number
  actualOutputWindowMode: 'execution_span' | 'net_run_segments'
  aggregationMode: 'total_ratio' | 'run_time_weighted_ratio'
  jobOrders: JobOrderProductivityBreakdown[]
}

export type ProductivityInput = {
  jobOrders: JobWindow[]
  clippedJobWindows: JobWindow[]
  productionRunWindows: OeeRange[]
  productStandardsByJobOrderId: Record<string, ProductStandardTimeline[]>
  quantityAdjustmentsByJobOrderId: Record<
    string,
    Array<{ _id: string; amount: number; time: Date | string }>
  >
  producedSummaryByTagId: Record<string, ProducedSummary>
  speedSummaryByTagId: Record<string, SpeedSummary>
  productivityMode: string
  productionCounterTagId: string | undefined
  speedTagId: string | undefined
  actualOutputWindowMode: 'execution_span' | 'net_run_segments'
  productivityAggregationMode: 'total_ratio' | 'run_time_weighted_ratio'
  allowProductivityOver100: boolean
}

// Split a window [start, end) at validFrom boundaries of standards sorted ascending.
// Returns sub-windows each associated with the standard valid at that time.
export function splitAtBoundaries(
  windowStart: Date,
  windowEnd: Date,
  standards: ProductStandardTimeline[],
): Array<{ start: Date; end: Date; standard: ProductStandardTimeline }> {
  if (standards.length === 0) return []

  // Sort ascending by validFrom
  const sorted = [...standards].sort(
    (a, b) => new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime(),
  )

  const result: Array<{ start: Date; end: Date; standard: ProductStandardTimeline }> = []

  for (let i = 0; i < sorted.length; i++) {
    const std = sorted[i]
    const stdStart = new Date(std.validFrom)
    const stdEnd =
      i + 1 < sorted.length ? new Date(sorted[i + 1].validFrom) : new Date(8640000000000000)

    const clipped = clip({ start: windowStart, end: windowEnd }, { start: stdStart, end: stdEnd })
    if (!clipped) continue
    result.push({ start: clipped.start, end: clipped.end, standard: std })
  }

  return result
}

// The actual output windows for a job order given the mode.
function actualOutputWindowsForJo(
  jo: JobWindow,
  productionRunWindows: OeeRange[],
  mode: 'execution_span' | 'net_run_segments',
): Array<{ from: Date; to: Date }> {
  if (mode === 'execution_span') {
    return [{ from: jo.start, to: jo.end }]
  }

  // net_run_segments: intersect production run windows with this JO's window
  const result: Array<{ from: Date; to: Date }> = []
  for (const rw of productionRunWindows) {
    const c = clip({ start: rw.from, end: rw.to }, { start: jo.start, end: jo.end })
    if (c) result.push({ from: c.start, to: c.end })
  }
  return result
}

// Telemetry windows: the output windows split at standard boundaries, so every measurement
// falls under a single standard even when the standard changes in the middle of a job order.
export function splitAtStandards(
  windows: Array<{ from: Date; to: Date }>,
  standards: ProductStandardTimeline[],
): Array<{ from: Date; to: Date }> {
  return windows.flatMap(w =>
    splitAtBoundaries(w.from, w.to, standards).map(sw => ({ from: sw.start, to: sw.end })),
  )
}

type Measurement = { from: string; to: string; amount: number }

// Output of the given windows in product units. Telemetry measured the windows built by
// splitAtStandards, so each measurement lies inside one standard's interval and that standard's
// rate converts it. Returns null when a standard has no usable rate.
function convertedOutput(
  windows: Array<{ from: Date; to: Date }>,
  standards: ProductStandardTimeline[],
  measurements: Measurement[],
  unitsPerAmount: (standard: ProductStandardTimeline) => number | null,
): number | null {
  let total = 0
  for (const w of windows) {
    for (const sw of splitAtBoundaries(w.from, w.to, standards)) {
      const rate = unitsPerAmount(sw.standard)
      if (rate === null) return null
      for (const m of measurements) {
        const from = new Date(m.from).getTime()
        const to = new Date(m.to).getTime()
        if (from >= sw.start.getTime() && to <= sw.end.getTime()) total += m.amount * rate
      }
    }
  }
  return Number.isFinite(total) ? total : null
}

const positive = (value: number | null) =>
  value != null && Number.isFinite(value) && value > 0 ? value : null

// Count based: telemetry counts raw counter steps (strokes, cycles, pulses) and counterMultiplier
// is the number of products per step.
export function countedOutput(
  windows: Array<{ from: Date; to: Date }>,
  standards: ProductStandardTimeline[],
  summary: ProducedSummary,
): number | null {
  return convertedOutput(
    windows,
    standards,
    summary.windows.map(w => ({ from: w.from, to: w.to, amount: w.value })),
    standard => positive(standard.counterMultiplier),
  )
}

// Speed based: telemetry integrates speed over time (speed × ms). At idealSpeed the machine makes
// idealOutputPerMinute, so a speed-minute is worth idealOutputPerMinute / idealSpeed products.
// counterMultiplier does not apply: cycle, stroke and pulse signals are modelled as count based.
export function speedOutput(
  windows: Array<{ from: Date; to: Date }>,
  standards: ProductStandardTimeline[],
  summary: SpeedSummary,
): number | null {
  return convertedOutput(
    windows,
    standards,
    summary.windows.map(w => ({ from: w.from, to: w.to, amount: w.valueArea })),
    standard => {
      const idealSpeed = positive(standard.idealSpeed)
      return idealSpeed === null ? null : standard.idealOutputPerMinute / idealSpeed / 60_000
    },
  )
}

function notCalculableBreakdown(
  jo: JobWindow,
  productionRunMs: number,
): JobOrderProductivityBreakdown {
  return {
    jobOrderId: jo.jobOrderId,
    productId: jo.productId,
    ratio: 0,
    actualOutput: 0,
    effectiveTargetOutput: 0,
    fullJobTargetOutput: 0,
    quantityAdjustment: 0,
    productionRunMs,
    notCalculable: true,
  }
}

function productionRunMsForJo(jo: JobWindow, productionRunWindows: OeeRange[]): number {
  let ms = 0
  for (const rw of productionRunWindows) {
    const c = clip({ start: rw.from, end: rw.to }, { start: jo.start, end: jo.end })
    if (c) ms += c.end.getTime() - c.start.getTime()
  }
  return ms
}

export function calculateProductivity(input: ProductivityInput): ProductivityResult {
  const {
    clippedJobWindows,
    productionRunWindows,
    productStandardsByJobOrderId,
    quantityAdjustmentsByJobOrderId,
    producedSummaryByTagId,
    speedSummaryByTagId,
    productivityMode,
    productionCounterTagId,
    speedTagId,
    actualOutputWindowMode,
    productivityAggregationMode,
    allowProductivityOver100,
  } = input

  const isCountBased = productivityMode === 'count_based'
  const producedSummary =
    isCountBased && productionCounterTagId
      ? (producedSummaryByTagId[productionCounterTagId] ?? null)
      : null
  const speedSummary =
    !isCountBased && speedTagId ? (speedSummaryByTagId[speedTagId] ?? null) : null

  const breakdowns: JobOrderProductivityBreakdown[] = []
  let anyNotCalculable = false

  for (const jo of clippedJobWindows) {
    const standards = productStandardsByJobOrderId[jo.jobOrderId] ?? []
    const joWindows = actualOutputWindowsForJo(jo, productionRunWindows, actualOutputWindowMode)
    const productionRunMs = productionRunMsForJo(jo, productionRunWindows)

    // Compute effectiveTargetOutput by splitting the actual output windows at standard boundaries
    let effectiveTargetOutput = 0
    let fullJobTargetOutput = 0
    let missingStandard = false

    // For effective target: split each actual output window at standard boundaries
    for (const jw of joWindows) {
      const subWindows = splitAtBoundaries(jw.from, jw.to, standards)
      if (subWindows.length === 0) {
        missingStandard = true
        break
      }
      for (const sw of subWindows) {
        const durationMin = (sw.end.getTime() - sw.start.getTime()) / 60000
        effectiveTargetOutput += durationMin * sw.standard.idealOutputPerMinute
      }
    }

    // Full job target: based on entire clipped JO window
    if (!missingStandard) {
      const fullSubWindows = splitAtBoundaries(jo.start, jo.end, standards)
      for (const sw of fullSubWindows) {
        const durationMin = (sw.end.getTime() - sw.start.getTime()) / 60000
        fullJobTargetOutput += durationMin * sw.standard.idealOutputPerMinute
      }
    }

    if (missingStandard) {
      anyNotCalculable = true
      breakdowns.push(notCalculableBreakdown(jo, productionRunMs))
      continue
    }

    // Compute actual output
    let measured: number | null = 0
    if (isCountBased && producedSummary) {
      measured = countedOutput(joWindows, standards, producedSummary)
    } else if (!isCountBased && speedSummary) {
      measured = speedOutput(joWindows, standards, speedSummary)
    }
    if (measured === null) {
      anyNotCalculable = true
      breakdowns.push(notCalculableBreakdown(jo, productionRunMs))
      continue
    }
    const grossProduced = measured

    const adjustments = (quantityAdjustmentsByJobOrderId[jo.jobOrderId] ?? []).filter(a => {
      const t = new Date(a.time).getTime()
      return t >= jo.start.getTime() && t <= jo.end.getTime()
    })
    const quantityAdjustment = adjustments.reduce((sum, a) => sum + a.amount, 0)
    const actualOutput = grossProduced + quantityAdjustment

    const ratio = effectiveTargetOutput > 0 ? actualOutput / effectiveTargetOutput : 0

    breakdowns.push({
      jobOrderId: jo.jobOrderId,
      productId: jo.productId,
      ratio,
      actualOutput,
      effectiveTargetOutput,
      fullJobTargetOutput,
      quantityAdjustment,
      productionRunMs,
      notCalculable: false,
    })
  }

  if (breakdowns.length === 0) {
    return {
      status: 'no_context',
      ratio: 0,
      actualOutput: 0,
      effectiveTargetOutput: 0,
      fullJobTargetOutput: 0,
      quantityAdjustment: 0,
      actualOutputWindowMode,
      aggregationMode: productivityAggregationMode,
      jobOrders: [],
    }
  }

  const status: ProductivityStatus = anyNotCalculable ? 'not_calculable' : 'ok'

  // Aggregate
  let aggregatedRatio = 0
  const totalActual = breakdowns.reduce((s, b) => s + b.actualOutput, 0)
  const totalEffectiveTarget = breakdowns.reduce((s, b) => s + b.effectiveTargetOutput, 0)
  const totalFullJobTarget = breakdowns.reduce((s, b) => s + b.fullJobTargetOutput, 0)
  const totalQtyAdj = breakdowns.reduce((s, b) => s + b.quantityAdjustment, 0)

  if (productivityAggregationMode === 'total_ratio') {
    aggregatedRatio = totalEffectiveTarget > 0 ? totalActual / totalEffectiveTarget : 0
  } else {
    // run_time_weighted_ratio: cap per-JO ratio at 1 before weighting when allowProductivityOver100=false
    const totalRunMs = breakdowns.reduce((s, b) => s + b.productionRunMs, 0)
    if (totalRunMs > 0) {
      aggregatedRatio =
        breakdowns.reduce((s, b) => {
          const r = !allowProductivityOver100 && b.ratio > 1 ? 1 : b.ratio
          return s + r * b.productionRunMs
        }, 0) / totalRunMs
    } else {
      aggregatedRatio = 0
    }
  }

  if (!allowProductivityOver100 && aggregatedRatio > 1) aggregatedRatio = 1

  return {
    status,
    ratio: aggregatedRatio,
    actualOutput: totalActual,
    effectiveTargetOutput: totalEffectiveTarget,
    fullJobTargetOutput: totalFullJobTarget,
    quantityAdjustment: totalQtyAdj,
    actualOutputWindowMode,
    aggregationMode: productivityAggregationMode,
    jobOrders: breakdowns,
  }
}
