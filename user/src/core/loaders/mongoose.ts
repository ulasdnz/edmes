import mongoose from 'mongoose'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'

// Register models up-front so index ensure phase sees all schemas.
import '../../modules/password-recovery/password-recovery.model.js'
import '../../modules/role/role.model.js'
import '../../modules/speciality/speciality.model.js'
import '../../modules/user/user.model.js'

const ensureModelIndexes = async (): Promise<void> => {
  if (config.MONGO_INDEX_STRATEGY !== 'ensure') return

  const modelEntries = Object.entries(mongoose.models)
  if (modelEntries.length === 0) {
    logger.warn('MongoDB index ensure skipped: no registered models')
    return
  }

  logger.info(`Ensuring MongoDB indexes for ${modelEntries.length} models...`)

  for (const [modelName, model] of modelEntries) {
    await model.createIndexes()
    logger.info(`MongoDB indexes ensured for model: ${modelName}`)
  }
}

export const initMongoose = async (): Promise<void> => {
  try {
    await mongoose.connect(config.MONGO_URI, {
      autoIndex: config.NODE_ENV === 'development',
      serverSelectionTimeoutMS: 5000,
    })

    await ensureModelIndexes()

    logger.info('MongoDB connected successfully')

    setupMongooseEventListeners()
  } catch (error) {
    logger.error('MongoDB connection failed', {
      error: error instanceof Error ? error.message : error,
    })
    throw error
  }
}

function setupMongooseEventListeners(): void {
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected unexpectedly')
  })
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected')
  })
  mongoose.connection.on('error', err => {
    logger.error('MongoDB connection error', {
      error: err instanceof Error ? err.message : err,
    })
  })
}
