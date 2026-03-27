import { logger } from '../../lib/logger.js'
import { initRedis } from '../../lib/redis.js'
import { initExpress } from './express.js'

export const initLoaders = async () => {
  try {
    logger.info('Initializing application loaders', { event: 'loader.init.started' })

    await initRedis()

    const app = await initExpress()

    logger.info('All loaders initialized successfully', { event: 'loader.init.completed' })
    return app
  } catch (error) {
    logger.error('Loader initialization failed', {
      event: 'loader.init.failed',
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    process.exit(1)
  }
}
