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

export const insertSample = async (tagId: string, sample: HistorianSample): Promise<void> => {
  const collectionName = `tag_samples_${tagId}`
  const collection = mongoose.connection.db!.collection(collectionName)
  await collection.insertOne(sample)
}
