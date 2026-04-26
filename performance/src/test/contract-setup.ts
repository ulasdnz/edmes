import { Redis } from 'ioredis'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

export let testRedis: Redis
export let testStreamRedis: Redis

let indexedModels = new Set<string>()

const ensureTestIndexes = async () => {
  for (const [modelName, model] of Object.entries(mongoose.models)) {
    if (indexedModels.has(modelName)) continue
    await model.createIndexes()
    indexedModels.add(modelName)
  }
}

beforeAll(async () => {
  const mongoUri = process.env.MONGO_URI!
  const redisUrl = process.env.REDIS_URL!

  // Each contract file gets its own Mongo DB inside the shared testcontainer.
  // Without this, cross-file mongoose state (singleton, models) plus the shared
  // afterEach collection wipe causes non-deterministic races where bootstrapped
  // system reasons disappear mid-test. Per-file dbName isolates writes/reads.
  const dbName = `ctest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await mongoose.connect(mongoUri, { dbName })
  indexedModels = new Set()
  await ensureTestIndexes()

  testRedis = new Redis(redisUrl, { enableOfflineQueue: false, lazyConnect: true })
  await testRedis.connect()

  testStreamRedis = new Redis(redisUrl, { enableOfflineQueue: false, lazyConnect: true })
  await testStreamRedis.connect()
}, 30_000)

afterAll(async () => {
  await testRedis?.quit()
  await testStreamRedis?.quit()
  await mongoose.disconnect()
})

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) {
    await ensureTestIndexes()
  }
})

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections
    for (const key in collections) {
      await collections[key].deleteMany({})
    }
  }
  await testRedis?.flushall()
})
