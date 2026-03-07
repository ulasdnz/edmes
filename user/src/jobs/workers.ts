import { Worker } from 'bullmq'
import { getBullConnectionOpts } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import authCacheInvalidateHandler from './handlers/auth-cache-invalidate.handler.js'
import stationDeletedHandler from './handlers/station-deleted.handler.js'
import departmentDeletedHandler from './handlers/department-deleted.handler.js'

let stationEventsWorker: Worker | null = null
let authCacheEventsWorker: Worker | null = null

/**
 * Initialize all BullMQ workers.
 * Called once during server boot from the loaders.
 */
export const initWorkers = () => {
  stationEventsWorker = new Worker(
    'station-events',
    async job => {
      switch (job.name) {
        case 'station.deleted':
          return stationDeletedHandler(job)
        case 'department.deleted':
          return departmentDeletedHandler(job)
        default:
          logger.warn(`Unknown job name in station-events queue: ${job.name}`)
      }
    },
    {
      connection: getBullConnectionOpts(),
      concurrency: 5,
    },
  )

  stationEventsWorker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} (${job?.name}) failed:`, { error: err.message })
  })

  stationEventsWorker.on('error', err => {
    logger.error('Station events worker error:', { error: err.message })
  })

  authCacheEventsWorker = new Worker(
    'auth-cache-events',
    async job => {
      switch (job.name) {
        case 'auth-cache.invalidate-user':
          return authCacheInvalidateHandler(job)
        default:
          logger.warn(`Unknown job name in auth-cache-events queue: ${job.name}`)
      }
    },
    {
      connection: getBullConnectionOpts(),
      concurrency: 10,
    },
  )

  authCacheEventsWorker.on('failed', (job, err) => {
    logger.error(`Auth cache job ${job?.id} (${job?.name}) failed:`, { error: err.message })
  })

  authCacheEventsWorker.on('error', err => {
    logger.error('Auth cache worker error:', { error: err.message })
  })

  logger.info('BullMQ workers initialized')
}

/**
 * Gracefully shut down all workers.
 * Called during server shutdown to allow in-progress jobs to complete.
 */
export const shutdownWorkers = async () => {
  if (stationEventsWorker) {
    await stationEventsWorker.close()
  }

  if (authCacheEventsWorker) {
    await authCacheEventsWorker.close()
  }

  logger.info('BullMQ workers shut down')
}
