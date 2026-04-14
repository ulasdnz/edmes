import { getHistorianCollection } from '../../ingestion/historian.repository.js'

interface BinaryDoc {
  occurredAt: Date
  value: number
}

export interface StateSegment {
  state: number
  start: Date
  end: Date
  durationMs: number
}

export const calculateStateDurations = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<StateSegment[]> => {
  const collection = getHistorianCollection(tagId)

  const baseline = await collection.findOne<BinaryDoc>(
    { occurredAt: { $lt: rangeStart } },
    { sort: { occurredAt: -1, _id: -1 } },
  )

  const docs = await collection
    .find<BinaryDoc>({ occurredAt: { $gte: rangeStart, $lte: rangeEnd } })
    .sort({ occurredAt: 1, _id: 1 })
    .toArray()

  if (!baseline && docs.length === 0) return []

  const segments: StateSegment[] = []
  let currentState: number
  let segmentStart: Date
  let startIdx: number

  if (baseline) {
    currentState = baseline.value
    segmentStart = rangeStart
    startIdx = 0
  } else {
    currentState = docs[0].value
    segmentStart = docs[0].occurredAt
    startIdx = 1
  }

  for (let i = startIdx; i < docs.length; i++) {
    const doc = docs[i]
    if (doc.value !== currentState) {
      const durationMs = doc.occurredAt.getTime() - segmentStart.getTime()
      if (durationMs > 0) {
        segments.push({
          state: currentState,
          start: segmentStart,
          end: doc.occurredAt,
          durationMs,
        })
      }
      currentState = doc.value
      segmentStart = doc.occurredAt
    }
  }

  const finalDurationMs = rangeEnd.getTime() - segmentStart.getTime()
  if (finalDurationMs > 0) {
    segments.push({
      state: currentState,
      start: segmentStart,
      end: rangeEnd,
      durationMs: finalDurationMs,
    })
  }

  return segments
}
