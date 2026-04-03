import mongoose from 'mongoose'

interface CounterDoc {
  occurredAt: Date
  value: number
  prevValue: number | null
  prev2Value: number | null
  reset: boolean
}

export const calculateProduced = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<number> => {
  const collectionName = `tag_samples_${tagId}`
  const collection = mongoose.connection.db!.collection(collectionName)

  const baseline = await collection.findOne<CounterDoc>(
    { occurredAt: { $lte: rangeStart } },
    { sort: { occurredAt: -1 } },
  )

  const docs = await collection
    .find<CounterDoc>({ occurredAt: { $gt: rangeStart, $lte: rangeEnd } })
    .sort({ occurredAt: 1 })
    .toArray()

  if (docs.length === 0) return 0

  const firstDoc = docs[0]
  const lastDoc = docs[docs.length - 1]

  let normalDelta: number
  if (docs.length === 1) {
    const openingValue = firstDoc.prevValue ?? baseline?.value ?? 0
    normalDelta = firstDoc.value - openingValue
  } else {
    const openingValue = firstDoc.prevValue ?? baseline?.value ?? 0
    const closingValue = Math.max(lastDoc.value, lastDoc.prevValue ?? lastDoc.value)
    normalDelta = closingValue - openingValue
  }

  const peakSum = docs
    .filter(d => d.reset && d.prev2Value != null)
    .reduce((sum, d) => sum + d.prev2Value!, 0)

  return normalDelta + peakSum
}
