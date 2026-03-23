import { runMigrations } from '../../database/migrations/index.js'
import { initSubscribers } from '../../jobs/subscribers.js'
import { logger } from '../../lib/logger.js'
import { initRedis } from '../../lib/redis.js'
import { initExpress } from './express.js'
import { initMongoose } from './mongoose.js'
import { ensureSystemAdmin } from './system-admin.js'

export const initLoaders = async () => {
  try {
    logger.info('Initializing application loaders', { event: 'loader.init.started' })

    await initMongoose()
    await initRedis()
    await runMigrations()
    await ensureSystemAdmin()
    await initSubscribers()

    const app = await initExpress()

    logger.info('All loaders initialized successfully', { event: 'loader.init.completed' })
    return app
  } catch (error) {
    logger.error('Loader initialization failed', {
      event: 'loader.init.failed',
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    process.exit(1) // Fail fast if a critical loader fails
  }
}
