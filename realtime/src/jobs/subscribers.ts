import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { resolveRooms } from '../gateway/router.js'
import { getIO } from '../gateway/socket.js'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const GROUP = 'realtime'
const CONSUMER_ID = `rt-${process.pid}`

const catchAll = async (data: Record<string, unknown>, type: string): Promise<void> => {
  const rooms = resolveRooms(type, data)
  const io = getIO()

  const emitter = rooms.length > 0 ? io.to(rooms) : io
  emitter.emit(type, data)

  logger.debug('Event forwarded', {
    event: 'gateway.event.forwarded',
    eventType: type,
    rooms,
  })
}

const streams: Record<string, Record<string, typeof catchAll>> = {
  'events.user': { '*': catchAll },
  'events.work_center': { '*': catchAll },
  'events.production': { '*': catchAll },
}

const consumer = createStreamConsumer({
  redis: streamClient,
  group: GROUP,
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

export const shutdownSubscribers = () => {
  consumer.stop()
}
