import { Redis, type RedisOptions } from 'ioredis'
import { config } from '../config/index.js'
import { logger } from './logger.js'

const REDIS_URL = config.REDIS_URL

if (!REDIS_URL) {
  throw new Error('REDIS_URL is not defined in environment variables')
}

const baseOptions: Omit<RedisOptions, 'keyPrefix'> = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  lazyConnect: true,
  connectTimeout: 10000,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 100, 2000)

    if (times === 1) {
      logger.warn('Redis: Reconnecting...')
    }
    if (times % 10 === 0) {
      logger.error(`Redis: Still attempting to reconnect... (${times} attempts)`)
    }

    return delay
  },
  reconnectOnError: err => {
    const targetError = 'READONLY'
    if (err.message.includes(targetError)) {
      return true
    }
    return false
  },
  keepAlive: 10000,
}

// Main client for general use (caching)
export const redisClient = new Redis(REDIS_URL, {
  ...baseOptions,
  keyPrefix: 'telemetry:',
})

redisClient.on('error', err => {
  logger.error('Redis Client Error:', { error: err.message })
})
redisClient.on('connect', () => logger.info('Redis: Connection established'))
redisClient.on('ready', () => logger.info('Redis: Ready to receive commands'))
redisClient.on('reconnecting', () => logger.warn('Redis: Reconnecting...'))

// Shared client for cross-service cache (auth context)
export const sharedClient = new Redis(REDIS_URL, baseOptions)

sharedClient.on('error', err => {
  logger.error('Redis Shared Client Error:', { error: err.message })
})

// Stream client for Redis Streams (publishing + consuming)
export const streamClient = new Redis(REDIS_URL, baseOptions)

streamClient.on('error', err => {
  logger.error('Redis Stream Client Error:', { error: err.message })
})

export const initRedis = async () => {
  try {
    await redisClient.connect()
    await redisClient.ping()
    logger.info('Redis: Initial connection verified')

    await sharedClient.connect()
    await sharedClient.ping()
    logger.info('Redis Shared Client: Connection verified')

    await streamClient.connect()
    await streamClient.ping()
    logger.info('Redis Stream Client: Connection verified')
  } catch (error) {
    logger.error('Redis: Initial connection failed')
    throw error
  }
}

export const closeRedis = async () => {
  await Promise.all([redisClient.quit(), sharedClient.quit(), streamClient.quit()])
}
