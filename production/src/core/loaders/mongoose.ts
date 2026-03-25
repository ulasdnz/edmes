import mongoose from 'mongoose'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'

// Register models up-front so index ensure phase sees all schemas.
import '../../modules/uom/uom.model.js'
import '../../modules/product-category/product-category.model.js'
import '../../modules/product/product.model.js'
import '../../modules/product-standard/product-standard.model.js'
import '../../modules/production-plan/production-plan.model.js'

const ensureModelIndexes = async (): Promise<void> => {
  if (config.MONGO_INDEX_STRATEGY !== 'ensure') return

  const modelEntries = Object.entries(mongoose.models)
  if (modelEntries.length === 0) {
    logger.warn('MongoDB index ensure skipped: no registered models', {
      event: 'db.mongo.index_skip',
    })
    return
  }

  logger.info(`Ensuring MongoDB indexes for ${modelEntries.length} models`, {
    event: 'db.mongo.index_start',
    modelCount: modelEntries.length,
  })

  for (const [modelName, model] of modelEntries) {
    await model.createIndexes()
    logger.debug(`MongoDB indexes ensured for model: ${modelName}`, {
      event: 'db.mongo.index_ensured',
      model: modelName,
    })
  }
}

export const initMongoose = async (): Promise<void> => {
  try {
    await mongoose.connect(config.MONGO_URI, {
      autoIndex: config.NODE_ENV === 'development',
      serverSelectionTimeoutMS: 5000,
    })

    await ensureModelIndexes()

    logger.info('MongoDB connected successfully', { event: 'db.mongo.connected' })

    setupMongooseEventListeners()
  } catch (error) {
    logger.error('MongoDB connection failed', {
      event: 'db.mongo.connection_failed',
      error: error instanceof Error ? error.message : error,
    })
    throw error
  }
}

function setupMongooseEventListeners(): void {
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected unexpectedly', { event: 'db.mongo.disconnected' })
  })
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected', { event: 'db.mongo.reconnected' })
  })
  mongoose.connection.on('error', err => {
    logger.error('MongoDB connection error', {
      event: 'db.mongo.error',
      error: err instanceof Error ? err.message : err,
    })
  })
}
