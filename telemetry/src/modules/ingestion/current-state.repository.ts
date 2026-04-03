import mongoose from 'mongoose'

const COLLECTION = 'current_states'

export const upsertCurrentState = async (
  tagId: string,
  value: number,
  occurredAt: Date,
): Promise<void> => {
  const collection = mongoose.connection.db!.collection(COLLECTION)
  await collection.updateOne(
    { tagId },
    { $set: { tagId, value, occurredAt, updatedAt: new Date() } },
    { upsert: true },
  )
}
