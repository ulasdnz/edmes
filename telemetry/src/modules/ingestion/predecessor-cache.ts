import mongoose from 'mongoose'

export interface PredecessorEntry {
  value: number
  occurredAt: Date
  prevValue: number | null
  prevTs: Date | null
  prev2Value?: number | null
  prev2Ts?: Date | null
}

const cache = new Map<string, PredecessorEntry>()

export const predecessorGet = (tagId: string): PredecessorEntry | undefined => cache.get(tagId)

export const predecessorSet = (tagId: string, entry: PredecessorEntry): void => {
  cache.set(tagId, entry)
}

export const predecessorDelete = (tagId: string): void => {
  cache.delete(tagId)
}

export const predecessorLoad = async (
  tagId: string,
  behavior: string,
): Promise<PredecessorEntry | undefined> => {
  const existing = cache.get(tagId)
  if (existing) return existing

  const collectionName = `tag_samples_${tagId}`
  const collection = mongoose.connection.db!.collection(collectionName)
  const lastDoc = await collection.findOne({}, { sort: { occurredAt: -1 } })
  if (!lastDoc) return undefined

  const entry: PredecessorEntry = {
    value: lastDoc.value as number,
    occurredAt: lastDoc.occurredAt as Date,
    prevValue: (lastDoc.prevValue as number) ?? null,
    prevTs: (lastDoc.prevTs as Date) ?? null,
  }

  if (behavior === 'counter') {
    entry.prev2Value = (lastDoc.prev2Value as number) ?? null
    entry.prev2Ts = (lastDoc.prev2Ts as Date) ?? null
  }

  cache.set(tagId, entry)
  return entry
}
