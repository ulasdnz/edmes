import { setupMongoDatabase } from '@mes/testing'
import mongoose from 'mongoose'
import { beforeAll, beforeEach } from 'vitest'

let indexedModels = new Set<string>()

const ensureTestIndexes = async () => {
  for (const [modelName, model] of Object.entries(mongoose.models)) {
    if (indexedModels.has(modelName)) continue
    await model.createIndexes()
    indexedModels.add(modelName)
  }
}

setupMongoDatabase()

beforeAll(async () => {
  indexedModels = new Set()
  await ensureTestIndexes()
})

beforeEach(async () => {
  if (mongoose.connection.readyState !== 0) {
    await ensureTestIndexes()
  }
})
