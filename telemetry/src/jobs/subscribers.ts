import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

let periodLockBefore: Date | null = null

export const getPeriodLock = () => periodLockBefore

export const setPeriodLock = (date: Date | null) => {
  periodLockBefore = date
}

const SERVICE_GROUP = 'telemetry-service'
const CONSUMER_ID = `telemetry-${process.pid}`

const consumer = createStreamConsumer({
  redis: streamClient,
  group: SERVICE_GROUP,
  consumer: CONSUMER_ID,
  streams: {
    // Period closure events (stream name TBD — will be events.production or similar)
    // 'events.production': {
    //   'period.closed': ({ lockedBefore }) => {
    //     periodLockBefore = new Date(lockedBefore as string)
    //   },
    // },
  },
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
