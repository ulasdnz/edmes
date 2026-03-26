import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { invalidateUserVisibility } from '../lib/internal-api.js'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const SERVICE_GROUP = 'work-center-service'
const CONSUMER_ID = `wc-${process.pid}`
const streams = {
  'events.user': {
    'user.updated': async (data: { userId: string }) => {
      await invalidateUserVisibility(data.userId)
      logger.debug('Invalidated visibility cache', {
        event: 'cache.visibility.invalidated',
        userId: data.userId,
      })
    },
  },
}

const consumer = createStreamConsumer({
  redis: streamClient,
  group: SERVICE_GROUP,
  consumer: CONSUMER_ID,
  streams,
  logger,
  runInContext: (traceId, fn) => runInContext({ traceId, ip: 'internal' }, fn),
})

/**
 * Start consuming cross-service events from Redis Streams.
 * The consumer runs as a background loop — don't await the returned promise
 * in the loader, it only resolves on shutdown.
 */
export const initSubscribers = () => {
  consumer.start().catch(err => {
    logger.error('Stream consumer crashed', {
      event: 'events.consumer.crashed',
      error: err instanceof Error ? err.message : err,
    })
  })
}

export const shutdownSubscribers = () => {
  consumer.stop()
}
