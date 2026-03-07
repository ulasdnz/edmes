import mongoose from 'mongoose'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'

export const initMongoose = async (): Promise<void> => {
  try {
    await mongoose.connect(config.MONGO_URI, {
      autoIndex: config.NODE_ENV === 'development',
      serverSelectionTimeoutMS: 5000,
    })
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
