import { Redis, type RedisOptions } from 'ioredis'
import { config } from '../config/index.js'
import { logger } from './logger.js'

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  lazyConnect: true,
  connectTimeout: 10000,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 100, 2000)
    if (times === 1) {
      logger.warn('Redis: Reconnecting...', { event: 'redis.reconnecting', attempt: times })
    }
    if (times % 10 === 0) {
      logger.warn(`Redis: Still attempting to reconnect... (${times} attempts)`, {
        event: 'redis.reconnecting',
        attempt: times,
      })
    }
    return delay
  },
  reconnectOnError: err => err.message.includes('READONLY'),
  keepAlive: 10000,
}

export const streamClient = new Redis(config.REDIS_URL, baseOptions)

streamClient.on('error', err => {
  logger.error('Redis Stream Client Error', { event: 'redis.stream.error', error: err.message })
})
streamClient.on('connect', () =>
  logger.info('Redis: Stream connection established', { event: 'redis.stream.connected' }),
)
streamClient.on('ready', () =>
  logger.info('Redis: Stream client ready', { event: 'redis.stream.ready' }),
)
streamClient.on('reconnecting', () =>
  logger.warn('Redis: Stream client reconnecting...', { event: 'redis.stream.reconnecting' }),
)

// Shared client for cross-service cache (auth context). No keyPrefix — keys are shared.
export const sharedClient = new Redis(config.REDIS_URL, baseOptions)

sharedClient.on('error', err => {
  logger.error('Redis Shared Client Error', { event: 'redis.shared.error', error: err.message })
})

export async function initRedis(): Promise<void> {
  await streamClient.connect()
  await sharedClient.connect()
  logger.info('Redis clients connected', { event: 'redis.init.completed' })
}

export async function closeRedis(): Promise<void> {
  await Promise.all([streamClient.quit(), sharedClient.quit()])
  logger.info('Redis clients disconnected', { event: 'redis.close.completed' })
}
