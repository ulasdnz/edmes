import { buildAuthContextCacheKey } from '@mes/auth'
import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { sharedCacheDel } from '../lib/cache.js'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'
import { handleRunModeSample } from '../modules/run-mode/run-mode.processor.js'
import { requestRefresh, seedFromCursors, syncWorkCenter, workCenterForTag } from './tag-map.js'

const SERVICE_GROUP = 'performance-service'
const CONSUMER_ID = `performance-${process.pid}`

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
  // Each one reads the work center from work-center, so the order they arrive in does not matter
  'events.work_center': {
    'work_center.created': async (data: { workCenterId: string }) =>
      syncWorkCenter(data.workCenterId),
    'work_center.updated': async (data: { workCenterId: string }) =>
      syncWorkCenter(data.workCenterId),
    'work_center.reactivated': async (data: { workCenterId: string }) =>
      syncWorkCenter(data.workCenterId),
    'work_center.archived': async (data: { workCenterId: string }) =>
      syncWorkCenter(data.workCenterId),
    'work_center.deleted': async (data: { workCenterId: string }) =>
      syncWorkCenter(data.workCenterId),
    'work_center.metric_composition.changed': async (data: { workCenterId: string }) =>
      syncWorkCenter(data.workCenterId),
  },
  'events.telemetry': {
    'tag.value.recorded': async (data: {
      tagId: string
      value: number
      occurredAt: string
      previousOccurredAt: string | null
    }) => {
      const workCenterId = workCenterForTag(data.tagId)
      if (!workCenterId) return
      await handleRunModeSample({
        workCenterId,
        runModeTagId: data.tagId,
        value: data.value,
        occurredAt: new Date(data.occurredAt),
        previousOccurredAt: data.previousOccurredAt ? new Date(data.previousOccurredAt) : null,
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

// The tag map is seeded from the cursors before the consumer starts, so the samples of work centers
// processed before are routed at once; the refresh from work-center runs in the background
export const initSubscribers = async () => {
  await seedFromCursors()
  requestRefresh()
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

export const __test__ = { streams }
