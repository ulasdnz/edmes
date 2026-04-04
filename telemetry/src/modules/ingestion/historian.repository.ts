import mongoose from 'mongoose'

export interface CounterSample {
  occurredAt: Date
  value: number
  prevValue: number | null
  prevTs: Date | null
  prev2Value: number | null
  prev2Ts: Date | null
  reset: boolean
}

export interface SpeedSample {
  occurredAt: Date
  value: number
  prevValue: number | null
  prevTs: Date | null
}

export interface BinarySample {
  occurredAt: Date
  value: number
  prevValue: number | null
  prevTs: Date | null
}

export type HistorianSample = CounterSample | SpeedSample | BinarySample

const getCollectionName = (tagId: string) => `tag_samples_${tagId}`

const historianCollectionInit = new Map<string, Promise<void>>()

const initializeHistorianCollection = async (tagId: string): Promise<void> => {
  const collectionName = getCollectionName(tagId)
  const collection = mongoose.connection.db!.collection(collectionName)
  await collection.createIndex({ occurredAt: 1 }, { name: 'occurredAt_1' })
}

const ensureHistorianCollectionInitialized = async (tagId: string): Promise<void> => {
  const existing = historianCollectionInit.get(tagId)
  if (existing) {
    await existing
    return
  }

  const initPromise = initializeHistorianCollection(tagId).catch(error => {
    historianCollectionInit.delete(tagId)
    throw error
  })

  historianCollectionInit.set(tagId, initPromise)
  await initPromise
}

export const getHistorianCollection = (tagId: string) => {
  return mongoose.connection.db!.collection(getCollectionName(tagId))
}

export const insertSample = async (tagId: string, sample: HistorianSample): Promise<void> => {
  await ensureHistorianCollectionInitialized(tagId)
  const collection = getHistorianCollection(tagId)
  await collection.insertOne(sample)
}
