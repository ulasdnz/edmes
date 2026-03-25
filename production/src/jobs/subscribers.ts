import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const SERVICE_GROUP = 'production-service'
const CONSUMER_ID = `prod-${process.pid}`
const streams = {
  // No external events consumed currently.
  // Future: 'events.work_center' consumption may be needed for cache invalidation or ref integrity.
}

const consumer =
  Object.keys(streams).length === 0
    ? null
    : createStreamConsumer({
        redis: streamClient,
        group: SERVICE_GROUP,
        consumer: CONSUMER_ID,
        streams,
        logger,
        runInContext: (traceId, fn) => runInContext({ traceId, ip: 'internal' }, fn),
      })

export const initSubscribers = () => {
  if (!consumer) {
    logger.info('No stream subscriptions configured; skipping consumer startup', {
      event: 'events.consumer.skipped',
      group: SERVICE_GROUP,
    })
    return
  }

  consumer.start().catch(err => {
    logger.error('Stream consumer crashed', {
      event: 'events.consumer.crashed',
      error: err instanceof Error ? err.message : err,
    })
  })
}

export const shutdownSubscribers = () => {
  consumer?.stop()
}
