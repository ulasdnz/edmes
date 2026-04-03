import mongoose from 'mongoose'

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
  const collectionName = `tag_samples_${tagId}`
  const collection = mongoose.connection.db!.collection(collectionName)

  const baseline = await collection.findOne<BinaryDoc>(
    { occurredAt: { $lte: rangeStart } },
    { sort: { occurredAt: -1 } },
  )

  const docs = await collection
    .find<BinaryDoc>({ occurredAt: { $gt: rangeStart, $lte: rangeEnd } })
    .sort({ occurredAt: 1 })
    .toArray()

  const segments: StateSegment[] = []
  let currentState = baseline?.value ?? 0
  let segmentStart = rangeStart

  for (const doc of docs) {
    if (doc.value !== currentState) {
      segments.push({
        state: currentState,
        start: segmentStart,
        end: doc.occurredAt,
        durationMs: doc.occurredAt.getTime() - segmentStart.getTime(),
      })
      currentState = doc.value
      segmentStart = doc.occurredAt
    }
  }

  segments.push({
    state: currentState,
    start: segmentStart,
    end: rangeEnd,
    durationMs: rangeEnd.getTime() - segmentStart.getTime(),
  })

  return segments
}
