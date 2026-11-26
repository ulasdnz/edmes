import mongoose from 'mongoose'

// Runs the call with the MongoDB profiler on and returns its result together with the operations
// it sent to the collection, so a test can check the plan a query used (planSummary,
// keysExamined, hasSortStage) or which command it ran.
export async function profileOperations<T>(
  collectionName: string,
  run: () => Promise<T>,
): Promise<{ result: T; operations: mongoose.mongo.Document[] }> {
  const db = mongoose.connection.db as mongoose.mongo.Db
  // The profiler waits 1 ms for a ticket and otherwise drops the entry without a word. Under the
  // load of a whole test run that lost about one entry in 30, so a test read no find at all, or
  // read "no aggregate" because the aggregate's entry was the one dropped.
  await db.admin().command({ setParameter: 1, internalQueryGlobalProfilingLockDeadlineMs: 5000 })
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
