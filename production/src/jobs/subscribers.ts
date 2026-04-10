import { buildAuthContextCacheKey } from '@mes/auth'
import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { sharedCacheDel } from '../lib/cache.js'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const SERVICE_GROUP = 'production-service'
const CONSUMER_ID = `prod-${process.pid}`
const streams = {
  'events.user': {
    'user.updated': async (data: { userId: string }) => {
      await sharedCacheDel(buildAuthContextCacheKey(data.userId))
      logger.debug('Invalidated auth context cache', {
        event: 'cache.auth_context.invalidated',
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

export const initSubscribers = () => {
  consumer.start().catch(err => {
    logger.error('Stream consumer crashed', {
      event: 'events.consumer.crashed',
      error: err instanceof Error ? err.message : err,
    })
  })
}

export const shutdownSubscribers = async (): Promise<void> => {
  await consumer.stop()
}
