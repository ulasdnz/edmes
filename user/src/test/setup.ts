import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll } from 'vitest'

let mongoContainer: StartedMongoDBContainer

beforeAll(async () => {
  mongoContainer = await new MongoDBContainer('mongo:7').start()
  let uri = mongoContainer.getConnectionString()
  if (!uri.includes('directConnection=true')) {
    uri += uri.includes('?') ? '&directConnection=true' : '?directConnection=true'
  }
  uri = uri.replace('localhost', '127.0.0.1')
  await mongoose.connect(uri)
}, 120000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongoContainer.stop()
})

afterEach(async () => {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections
    for (const key in collections) {
      await collections[key].deleteMany({})
    }
  }
})
