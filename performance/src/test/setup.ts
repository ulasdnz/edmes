import { MONGO_IMAGE } from '@mes/testing'
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

let mongoContainer: StartedMongoDBContainer
let indexedModels = new Set<string>()

const ensureTestIndexes = async () => {
  for (const [modelName, model] of Object.entries(mongoose.models)) {
    if (indexedModels.has(modelName)) continue
    await model.createIndexes()
    indexedModels.add(modelName)
  }
}

beforeAll(async () => {
  mongoContainer = await new MongoDBContainer(MONGO_IMAGE).start()
  let uri = mongoContainer.getConnectionString()
  if (!uri.includes('directConnection=true')) {
    uri += uri.includes('?') ? '&directConnection=true' : '?directConnection=true'
  }
  uri = uri.replace('localhost', '127.0.0.1')
  await mongoose.connect(uri)
  indexedModels = new Set()
  await ensureTestIndexes()
}, 120000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongoContainer.stop()
})

beforeEach(async () => {
  if (mongoose.connection.readyState !== 0) {
    await ensureTestIndexes()
  }
})

afterEach(async () => {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections
    for (const key in collections) {
      await collections[key].deleteMany({})
    }
  }
})
