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

export const initRedis = async () => {
  try {
    await redisClient.connect()
    // Verify connection with a ping
    await redisClient.ping()
    logger.info('Redis: Initial connection verified')
  } catch (error) {
    logger.error('Redis: Initial connection failed')
    throw error // Fail fast in loader
  }
}

export const closeRedis = async () => {
  await redisClient.quit()
}

// â”€â”€ BullMQ connection factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// BullMQ creates its own ioredis instance internally.
// We return a plain connection config object to avoid duplicate ioredis
// type conflicts between hoisted and nested ioredis packages.

import type { ConnectionOptions } from 'bullmq'

/**
 * Returns BullMQ-compatible connection options.
 * No keyPrefix â€” BullMQ manages its own key namespace (`bull:<queue>:<id>`).
 */
export const getBullConnectionOpts = (): ConnectionOptions => ({
  host: new URL(REDIS_URL).hostname,
  port: Number(new URL(REDIS_URL).port) || 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  connectTimeout: 10000,
  keepAlive: 10000,
})

