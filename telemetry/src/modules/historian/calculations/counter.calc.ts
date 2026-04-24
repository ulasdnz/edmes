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

// Half-open (from, to] semantic so adjacent windows that share a boundary sample
// do not double-count the delta across that boundary.
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
