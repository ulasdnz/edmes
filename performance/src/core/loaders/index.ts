import { initSubscribers } from '../../jobs/subscribers.js'
import { logger } from '../../lib/logger.js'
import { initRedis } from '../../lib/redis.js'
import { startPlannedStopScheduler } from '../../modules/planned-stop-schedule/planned-stop-schedule.scheduler.js'
import { bootstrapSystemReasons } from '../../modules/reason/reason.bootstrap.js'
import { startDebounceTick } from '../../modules/run-mode/run-mode.debounce-tick.js'
import { reconcileOnBoot } from '../../modules/run-mode/run-mode.reconciler.js'
import { initExpress } from './express.js'
import { initMongoose } from './mongoose.js'

export const initLoaders = async () => {
  try {
    logger.info('Initializing application loaders', { event: 'loader.init.started' })

    await initMongoose()
    await initRedis()
    await bootstrapSystemReasons()
    await initSubscribers()

    const app = await initExpress()

    await reconcileOnBoot()
    await startPlannedStopScheduler()
    startDebounceTick()

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
