import mongoose from 'mongoose'

// Runs the call with the MongoDB profiler on and returns its result together with the operations
// it sent to the collection, so a test can check the plan a query used (planSummary,
// keysExamined, hasSortStage) or which command it ran.
export async function profileOperations<T>(
  collectionName: string,
  run: () => Promise<T>,
): Promise<{ result: T; operations: mongoose.mongo.Document[] }> {
  const db = mongoose.connection.db as mongoose.mongo.Db
  await db.command({ profile: 0 })
  // Operations profiled by an earlier call would otherwise be read as this call's
  await db.collection('system.profile').drop()

  await db.command({ profile: 2 })
  let result: T
  try {
    result = await run()
  } finally {
    await db.command({ profile: 0 })
  }

  const operations = await db
    .collection('system.profile')
    .find({ ns: `${db.databaseName}.${collectionName}` })
    .toArray()
  return { result, operations }
}
