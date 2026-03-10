import { Redis, type RedisOptions } from 'ioredis'
import { config } from '../config/index.js'
import { logger } from './logger.js'

const REDIS_URL = config.REDIS_URL

if (!REDIS_URL) {
  throw new Error('REDIS_URL is not defined in environment variables')
}

const redisOptions: RedisOptions = {
  keyPrefix: 'user:',
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
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

// Main client for general use (caching, rate limiting, JWT blacklist)
export const redisClient = new Redis(REDIS_URL, redisOptions)

// Attach error listener to prevent process crash
redisClient.on('error', err => {
  logger.error('Redis Client Error:', { error: err.message })
})

redisClient.on('connect', () => logger.info('Redis: Connection established'))
redisClient.on('ready', () => logger.info('Redis: Ready to receive commands'))
redisClient.on('reconnecting', () => logger.warn('Redis: Reconnecting...'))

// ── Subscriber client for Redis Pub/Sub ─────────────────────────────────────
// A client in subscribe mode cannot run other commands,
// so we use a dedicated connection.
export const subscriberClient = new Redis(REDIS_URL, {
  ...redisOptions,
  keyPrefix: undefined, // Pub/Sub channels don't use key prefixes
})

subscriberClient.on('error', err => {
  logger.error('Redis Subscriber Error:', { error: err.message })
})

export const initRedis = async () => {
  try {
    await redisClient.connect()
    await redisClient.ping()
    logger.info('Redis: Initial connection verified')

    await subscriberClient.connect()
    await subscriberClient.ping()
    logger.info('Redis Subscriber: Connection verified')
  } catch (error) {
    logger.error('Redis: Initial connection failed')
    throw error // Fail fast in loader
  }
}

export const closeRedis = async () => {
  await redisClient.quit()
}
