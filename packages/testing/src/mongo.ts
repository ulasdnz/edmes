import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, inject } from 'vitest'
import './provided-context.js'

// Connects the test file to a database of its own on the MongoDB the package's global setup started
// (mongo-server.ts), empties its collections after each test and drops the database once the file
// is done, so the files running in parallel never see each other's data
export function setupMongoDatabase(): void {
  beforeAll(async () => {
    await mongoose.connect(inject('mongoUri'), {
      dbName: `test_${randomUUID().replaceAll('-', '')}`,
    })
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  })

  afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      const collections = mongoose.connection.collections
      for (const key in collections) {
        await collections[key].deleteMany({})
      }
    }
  })
}
