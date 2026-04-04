import CurrentState from './current-state.model.js'

export const upsertCurrentState = async (
  tagId: string,
  value: number,
  occurredAt: Date,
): Promise<void> => {
  await CurrentState.updateOne(
    { tagId },
    { $set: { tagId, value, occurredAt, updatedAt: new Date() } },
    { upsert: true },
  )
}
