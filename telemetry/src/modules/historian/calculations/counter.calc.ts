import { getHistorianCollection } from '../../ingestion/historian.repository.js'

interface CounterDoc {
  occurredAt: Date
  value: number
  prevValue: number | null
  prevTs: Date | null
  prev2Value: number | null
  reset: boolean
}

export interface ProducedWindowInput {
  from: Date
  to: Date
}

export type ProducedQualityFlag = 'missing_baseline' | 'counter_reset_observed' | 'samples_missing'

export interface ProducedWindowResult {
  from: Date
  to: Date
  value: number
  qualityFlags: ProducedQualityFlag[]
}

export interface ProducedMultiResult {
  windows: ProducedWindowResult[]
  total: number
}

/**
 * Returns the index of the first doc whose `occurredAt` is strictly greater than `t`.
 *
 * Implements per-window `(from, to]` semantics for delta calculation: a sample landing
 * exactly on a window boundary belongs to the *previous* window's closing value (and to
 * the next window's opening baseline), never to both windows' in-window slice. This is
 * the right shape for counter-delta math — adjacent windows that share a boundary
 * sample do not double-count the delta across that boundary.
 *
 * Note: this is intentionally different from the project-wide `[from, to)` range-query
 * convention. The convention applies to instant filters; counter delta is a stateful
 * algorithm whose boundary handling is dictated by what produces correct deltas, not
 * tile semantics alone.
 */
const firstIndexAfter = (docs: CounterDoc[], t: number): number => {
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
  docs: CounterDoc[],
  baseline: CounterDoc | null,
): ProducedWindowResult => {
  const flags: ProducedQualityFlag[] = []

  if (docs.length === 0) {
    flags.push('samples_missing')
    return { from, to, value: 0, qualityFlags: flags }
  }

  const firstDoc = docs[0]
  const lastDoc = docs[docs.length - 1]
  const resolvedOpening = firstDoc.prevValue ?? baseline?.value ?? null
  if (resolvedOpening == null) flags.push('missing_baseline')
  const openingValue = resolvedOpening ?? 0

  let normalDelta: number
  if (docs.length === 1) {
    normalDelta = firstDoc.value - openingValue
  } else {
    const closingValue = Math.max(lastDoc.value, lastDoc.prevValue ?? lastDoc.value)
    normalDelta = closingValue - openingValue
  }

  let peakSum = 0
  let resetObserved = false
  for (const d of docs) {
    if (d.reset && d.prev2Value != null && d.prevTs != null && d.prevTs >= from) {
      peakSum += d.prev2Value
      resetObserved = true
    }
  }
  if (resetObserved) flags.push('counter_reset_observed')

  return { from, to, value: normalDelta + peakSum, qualityFlags: flags }
}

/**
 * Computes counter-based produced quantities across multiple windows in one round trip.
 *
 * Per-window semantics: `(from, to]` (see `firstIndexAfter`). A sample whose `occurredAt`
 * equals a window's `from` is *not* in that window's slice — it serves as the window's
 * opening baseline (`allDocs[startIdx - 1]`) so the delta is computed against it.
 *
 * DB fetch boundaries are deliberately closed on both sides (`{ $gte: overallFrom,
 * $lte: overallTo }`). Excluding the `overallFrom` sample (e.g. switching to `$gt`)
 * would drop a sample that may be the only baseline candidate — the separate baseline
 * query (`$lt: overallFrom`) only finds samples *before* the range, so a sample at
 * exactly `overallFrom` would be lost from both queries and the first window's delta
 * would be wrong.
 */
export const calculateProducedMulti = async (
  tagId: string,
  windows: ProducedWindowInput[],
): Promise<ProducedMultiResult> => {
  if (windows.length === 0) return { windows: [], total: 0 }

  const collection = getHistorianCollection(tagId)

  const overallFrom = windows.reduce(
    (min, w) => (w.from.getTime() < min.getTime() ? w.from : min),
    windows[0].from,
  )
  const overallTo = windows.reduce(
    (max, w) => (w.to.getTime() > max.getTime() ? w.to : max),
    windows[0].to,
  )

  const baseline = await collection.findOne<CounterDoc>(
    { occurredAt: { $lt: overallFrom } },
    { sort: { occurredAt: -1 } },
  )

  const allDocs = await collection
    .find<CounterDoc>({ occurredAt: { $gte: overallFrom, $lte: overallTo } })
    .sort({ occurredAt: 1 })
    .toArray()

  const results: ProducedWindowResult[] = windows.map(w => {
    const startIdx = firstIndexAfter(allDocs, w.from.getTime())
    const endIdx = firstIndexAfter(allDocs, w.to.getTime())
    const docsInWindow = allDocs.slice(startIdx, endIdx)
    const windowBaseline = startIdx > 0 ? allDocs[startIdx - 1] : baseline
    return computeWindow(w.from, w.to, docsInWindow, windowBaseline)
  })

  const total = results.reduce((sum, r) => sum + r.value, 0)
  return { windows: results, total }
}

export const calculateProduced = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<number> => {
  const result = await calculateProducedMulti(tagId, [{ from: rangeStart, to: rangeEnd }])
  return result.windows[0]?.value ?? 0
}
