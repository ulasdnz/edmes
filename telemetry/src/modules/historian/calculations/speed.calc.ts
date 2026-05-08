import { getHistorianCollection } from '../../ingestion/historian.repository.js'

interface SpeedDoc {
  occurredAt: Date
  value: number
}

export interface SpeedWindowInput {
  from: Date
  to: Date
}

export interface SpeedWindowResult {
  from: Date
  to: Date
  durationMs: number
  timeWeightedAverage: number
  valueArea: number
  sampleCount: number
}

export interface SpeedMultiResult {
  windows: SpeedWindowResult[]
  total: {
    durationMs: number
    timeWeightedAverage: number
    valueArea: number
  }
}

/**
 * Returns the index of the first doc whose `occurredAt` is `>= t`.
 *
 * Pairs with `upperBoundByTime` to implement per-window `[from, to]` (closed) semantics
 * for time-weighted area-integral calculation. A sample landing exactly on `from` is
 * the integral's starting point and contributes to the area; a sample at exactly `to`
 * is the integral's closing point.
 *
 * Different from counter-calc's `(from, to]` semantics: counter is stateful delta math
 * (a boundary sample serves as baseline, not as a window member); speed is value-area
 * integration where the boundary value is the integration starting condition.
 */
const lowerBoundByTime = (docs: SpeedDoc[], t: number): number => {
  let lo = 0
  let hi = docs.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (docs[mid].occurredAt.getTime() < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Returns the index of the first doc whose `occurredAt` is strictly greater than `t`
 * — i.e. one past the last doc with `occurredAt <= t`. Provides the closed right
 * boundary for `[from, to]` per-window semantics.
 */
const upperBoundByTime = (docs: SpeedDoc[], t: number): number => {
  let lo = 0
  let hi = docs.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (docs[mid].occurredAt.getTime() <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

const computeWindow = (
  from: Date,
  to: Date,
  docs: SpeedDoc[],
  baseline: SpeedDoc | null,
): SpeedWindowResult => {
  const points: { time: Date; value: number }[] = []

  if (baseline) {
    points.push({ time: from, value: baseline.value })
  } else if (docs.length > 0) {
    points.push({ time: from, value: 0 })
  } else {
    return {
      from,
      to,
      durationMs: 0,
      timeWeightedAverage: 0,
      valueArea: 0,
      sampleCount: 0,
    }
  }

  for (const doc of docs) {
    points.push({ time: doc.occurredAt, value: doc.value })
  }

  points.push({ time: to, value: points[points.length - 1].value })

  let valueArea = 0
  for (let i = 0; i < points.length - 1; i++) {
    const dur = points[i + 1].time.getTime() - points[i].time.getTime()
    valueArea += points[i].value * dur
  }

  const durationMs = to.getTime() - from.getTime()
  const timeWeightedAverage = durationMs > 0 ? valueArea / durationMs : 0

  return { from, to, durationMs, valueArea, timeWeightedAverage, sampleCount: docs.length }
}

/**
 * Computes time-weighted speed averages across multiple windows in one round trip.
 *
 * Per-window semantics: `[from, to]` (closed). A sample at exactly `from` is the
 * integral's opening value; a sample at exactly `to` is its closing value. The
 * trapezoidal sum yields the area, and the time-weighted average is `area / duration`.
 *
 * DB fetch boundaries are deliberately closed on both sides (`{ $gte: overallFrom,
 * $lte: overallTo }`). Excluding the `overallFrom` sample (e.g. switching to `$gt`)
 * would zero out the integral's opening point: the separate baseline query
 * (`$lt: overallFrom`) only finds samples *before* the range, so a sample at exactly
 * `overallFrom` would be lost from both queries and the time-weighted average would
 * collapse to whatever the prior baseline value was, ignoring the value change at the
 * window's opening instant.
 */
export const calculateSpeedAvgMulti = async (
  tagId: string,
  windows: SpeedWindowInput[],
): Promise<SpeedMultiResult> => {
  if (windows.length === 0) {
    return { windows: [], total: { durationMs: 0, timeWeightedAverage: 0, valueArea: 0 } }
  }

  const collection = getHistorianCollection(tagId)

  const overallFrom = windows.reduce(
    (min, w) => (w.from.getTime() < min.getTime() ? w.from : min),
    windows[0].from,
  )
  const overallTo = windows.reduce(
    (max, w) => (w.to.getTime() > max.getTime() ? w.to : max),
    windows[0].to,
  )

  const baseline = await collection.findOne<SpeedDoc>(
    { occurredAt: { $lt: overallFrom } },
    { sort: { occurredAt: -1 } },
  )

  const allDocs = await collection
    .find<SpeedDoc>({ occurredAt: { $gte: overallFrom, $lte: overallTo } })
    .sort({ occurredAt: 1 })
    .toArray()

  const results: SpeedWindowResult[] = windows.map(w => {
    const startIdx = lowerBoundByTime(allDocs, w.from.getTime())
    const endIdx = upperBoundByTime(allDocs, w.to.getTime())
    const docsInWindow = allDocs.slice(startIdx, endIdx)
    const windowBaseline = startIdx > 0 ? allDocs[startIdx - 1] : baseline
    return computeWindow(w.from, w.to, docsInWindow, windowBaseline)
  })

  const totalDurationMs = results.reduce((s, r) => s + r.durationMs, 0)
  const totalValueArea = results.reduce((s, r) => s + r.valueArea, 0)
  const totalAvg = totalDurationMs > 0 ? totalValueArea / totalDurationMs : 0

  return {
    windows: results,
    total: {
      durationMs: totalDurationMs,
      timeWeightedAverage: totalAvg,
      valueArea: totalValueArea,
    },
  }
}

export const calculateSpeedAvg = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ totalArea: number; weightedAvg: number; durationSec: number }> => {
  const result = await calculateSpeedAvgMulti(tagId, [{ from: rangeStart, to: rangeEnd }])
  const w = result.windows[0]
  if (!w) return { totalArea: 0, weightedAvg: 0, durationSec: 0 }
  return {
    totalArea: w.valueArea / 1000,
    weightedAvg: w.timeWeightedAverage,
    durationSec: w.durationMs / 1000,
  }
}
