import { buildAuthContextCacheKey } from '@mes/auth'
import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { sharedCacheDel } from '../lib/cache.js'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'
import { autoCheckOutByShiftEnd } from '../modules/operators/operators.service.js'

const SERVICE_GROUP = 'work-center-service'
const CONSUMER_ID = `wc-${process.pid}`
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
  'events.work_center': {
    'work_center.shift.ended': async (data: {
      shiftId: string
      occurrenceDay: string
      endedAt: string
    }) => {
      const result = await autoCheckOutByShiftEnd(
        data.shiftId,
        data.occurrenceDay,
        new Date(data.endedAt),
      )
      logger.info('Shift ended auto check-out processed', {
        event: 'operators.auto_checkout.shift_ended',
        shiftId: data.shiftId,
        occurrenceDay: data.occurrenceDay,
        affectedCount: result.affectedWorkCenterIds.length,
        closedCount: result.closedCheckInIds.length,
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

export const shutdownSubscribers = async (): Promise<void> => {
  await consumer.stop()
}
