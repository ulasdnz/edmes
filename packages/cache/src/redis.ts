import { Redis } from 'ioredis'
import type { Logger } from 'winston'

export interface RedisClientOptions {
  /** Short name used in logs, e.g. 'cache', 'shared' or 'stream'. */
  name: string
  /** Prefix for service-local keys. Omit it for keys and streams other services read too. */
  keyPrefix?: string
  logger: Logger
}

/**
 * Creates an ioredis client with the settings every service shares. The client connects on
 * `connect()`, and commands fail fast while Redis is unreachable instead of queueing in memory.
 */
export const createRedisClient = (
  url: string,
  { name, keyPrefix, logger }: RedisClientOptions,
): Redis => {
  const client = new Redis(url, {
    ...(keyPrefix ? { keyPrefix } : {}),
    lazyConnect: true,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
    keepAlive: 10_000,
    retryStrategy: attempt => {
      if (attempt === 1) {
        logger.warn(`Redis ${name} client reconnecting`, {
          event: 'redis.client.reconnecting',
          client: name,
          attempt,
        })
      } else if (attempt % 10 === 0) {
        logger.error(`Redis ${name} client still reconnecting`, {
          event: 'redis.client.reconnecting',
          client: name,
          attempt,
        })
      }
      return Math.min(attempt * 100, 2000)
    },
    // A failover can leave the connection on a read-only replica; reconnect to reach the primary.
    reconnectOnError: err => err.message.includes('READONLY'),
  })

  client.on('error', err => {
    logger.error(`Redis ${name} client error`, {
      event: 'redis.client.error',
      client: name,
      error: err.message,
    })
  })
  client.on('ready', () => {
    logger.info(`Redis ${name} client ready`, { event: 'redis.client.ready', client: name })
  })

  return client
}
