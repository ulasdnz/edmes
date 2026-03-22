import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const SERVICE_GROUP = 'work-center-service'
const CONSUMER_ID = `wc-${process.pid}`

const consumer = createStreamConsumer({
  redis: streamClient,
  group: SERVICE_GROUP,
  consumer: CONSUMER_ID,
  streams: {
    // No external events consumed currently.
    // Future: 'events.user': { 'user.deleted': cleanupHandler }
  },
  logger,
  runInContext: (traceId, fn) => runInContext({ traceId, ip: 'internal' }, fn),
})

/**
 * Start consuming cross-service events from Redis Streams.
 * The consumer runs as a background loop — don't await the returned promise
 * in the loader, it only resolves on shutdown.
 */
export const initSubscribers = () => {
  // Start the poll loop in the background. Errors are logged internally.
  consumer.start().catch(err => {
    logger.error('Stream consumer crashed', {
      event: 'events.consumer.crashed',
      error: err instanceof Error ? err.message : err,
    })
  })
}

/**
 * Stop the consumer gracefully.
 */
export const shutdownSubscribers = () => {
  consumer.stop()
}
