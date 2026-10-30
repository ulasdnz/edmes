import { buildAuthContextCacheKey } from '@mes/auth'
import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { sharedCacheDel } from '../lib/cache.js'
import { listRunModeMonitors } from '../lib/internal-api/run-mode-monitors.client.js'
import {
  getById as getWorkCenter,
  invalidate as invalidateWorkCenter,
} from '../lib/internal-api/work-center.client.js'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'
import {
  handleRunModeSample,
  listMonitoredFromCursors,
} from '../modules/run-mode/run-mode.processor.js'

const SERVICE_GROUP = 'performance-service'
const CONSUMER_ID = `performance-${process.pid}`

const runModeTagToWorkCenter = new Map<string, string>()

async function syncRunModeTag(workCenterId: string): Promise<void> {
  await invalidateWorkCenter(workCenterId)
  for (const [tagId, wc] of runModeTagToWorkCenter) {
    if (wc === workCenterId) runModeTagToWorkCenter.delete(tagId)
  }
  const wc = await getWorkCenter(workCenterId)
  const runModeTagId = wc?.tagBindings?.runModeTagId
  if (runModeTagId) {
    runModeTagToWorkCenter.set(runModeTagId, workCenterId)
  }
}

function dropWorkCenter(workCenterId: string): void {
  for (const [tagId, wc] of runModeTagToWorkCenter) {
    if (wc === workCenterId) runModeTagToWorkCenter.delete(tagId)
  }
}

async function seedRunModeTagMap(): Promise<void> {
  try {
    const cursors = await listMonitoredFromCursors()
    for (const c of cursors) {
      runModeTagToWorkCenter.set(c.runModeTagId, c.workCenterId)
    }
    const monitors = await listRunModeMonitors()
    for (const m of monitors) {
      runModeTagToWorkCenter.set(m.runModeTagId, m.workCenterId)
    }
  } catch (err) {
    logger.warn('Failed to seed run-mode tag map', {
      event: 'run_mode.tag_map.seed_failed',
      error: err instanceof Error ? err.message : err,
    })
  }
}

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
    'work_center.created': async (data: { workCenterId: string }) =>
      syncRunModeTag(data.workCenterId),
    'work_center.updated': async (data: { workCenterId: string }) =>
      syncRunModeTag(data.workCenterId),
    'work_center.reactivated': async (data: { workCenterId: string }) =>
      syncRunModeTag(data.workCenterId),
    'work_center.archived': async (data: { workCenterId: string }) => {
      await invalidateWorkCenter(data.workCenterId)
      dropWorkCenter(data.workCenterId)
    },
    'work_center.deleted': async (data: { workCenterId: string }) => {
      await invalidateWorkCenter(data.workCenterId)
      dropWorkCenter(data.workCenterId)
    },
    'work_center.metric_composition.changed': async (data: { workCenterId: string }) =>
      syncRunModeTag(data.workCenterId),
  },
  'events.telemetry': {
    'tag.value.recorded': async (data: { tagId: string; value: number; occurredAt: string }) => {
      const workCenterId = runModeTagToWorkCenter.get(data.tagId)
      if (!workCenterId) return
      await handleRunModeSample({
        workCenterId,
        runModeTagId: data.tagId,
        value: data.value,
        occurredAt: new Date(data.occurredAt),
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
  void seedRunModeTagMap()
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

export const __test__ = {
  runModeTagToWorkCenter,
  syncRunModeTag,
  dropWorkCenter,
  seedRunModeTagMap,
  streams,
}
