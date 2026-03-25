import mongoose from 'mongoose'
import { config } from '../config/index.js'
import { logger } from '../lib/logger.js'

export async function connectDB() {
  try {
    await mongoose.connect(config.MONGO_URI, {
      autoIndex: config.NODE_ENV === 'development',
      serverSelectionTimeoutMS: 5000,
    })
    logger.info('MongoDB connected successfully (manual)')
  } catch (error) {
    logger.error('MongoDB connection failed:', error)
    process.exit(1)
  }
}

export async function disconnectDB() {
  try {
    await mongoose.connection.close()
    logger.info('MongoDB connection closed (manual)')
  } catch (error) {
    logger.error('Error while closing MongoDB connection:', error)
  }
}
