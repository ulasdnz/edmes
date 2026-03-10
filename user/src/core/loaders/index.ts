import { initSubscribers } from '../../jobs/subscribers.js'
import { logger } from '../../lib/logger.js'
import { initRedis } from '../../lib/redis.js'
import { initExpress } from './express.js'
import { initMongoose } from './mongoose.js'

export const initLoaders = async () => {
  try {
    logger.info('Initializing application loaders...')

    await initMongoose()
    await initRedis()
    await initSubscribers()

    const app = await initExpress()

    logger.info('All loaders initialized successfully')
    return app
  } catch (error) {
    logger.error('Loader initialization failed:', error)
    console.error('RAW ERROR TRACE:', error)
    process.exit(1) // Fail fast if a critical loader fails
  }
}
