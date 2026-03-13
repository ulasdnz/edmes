/**
 * Redis-backed cache utility with singleflight integration.
 *
 * Provides cache-aside pattern: get → miss → execute fn → set → return.
 * Combined with singleflight to prevent thundering herd on cold cache.
 *
 * Uses dependency injection: call `setupCache(redis, logger)` to create
 * cache functions bound to a specific Redis client and logger instance.
 */

import type { Redis } from 'ioredis'
import type { Logger } from 'winston'
import { singleflight } from './singleflight.js'

export const setupCache = (redisClient: Redis, logger: Logger) => {
  const cacheGet = async <T>(key: string): Promise<T | null> => {
    try {
      const raw = await redisClient.get(key)
      if (raw === null) return null

      return JSON.parse(raw) as T
    } catch (error) {
      logger.warn('Cache GET failed, skipping cache', {
        event: 'cache.get.failed',
        key,
        error: (error as Error).message,
      })
      return null
    }
  }

  const cacheSet = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
    try {
      const serialized = JSON.stringify(value)
      await redisClient.set(key, serialized, 'EX', ttlSeconds)
    } catch (error) {
      logger.warn('Cache SET failed, skipping cache', {
        event: 'cache.set.failed',
        key,
        error: (error as Error).message,
      })
    }
  }

  const cacheDel = async (key: string): Promise<void> => {
    try {
      await redisClient.del(key)
    } catch (error) {
      logger.warn('Cache DEL failed', {
        event: 'cache.del.failed',
        key,
        error: (error as Error).message,
      })
    }
  }

  const cacheDelPattern = async (pattern: string): Promise<number> => {
    try {
      let deleted = 0
      const stream = redisClient.scanStream({ match: pattern, count: 100 })

      for await (const keys of stream) {
        if ((keys as string[]).length > 0) {
          deleted += await redisClient.del(...(keys as string[]))
        }
      }

      return deleted
    } catch (error) {
      logger.warn('Cache DEL pattern failed', {
        event: 'cache.del_pattern.failed',
        pattern,
        error: (error as Error).message,
      })
      return 0
    }
  }

  const cacheWrap = async <T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> => {
    const cached = await cacheGet<T>(key)
    if (cached !== null) return cached

    const result = await fn()

    if (result !== null && result !== undefined) {
      await cacheSet(key, result, ttl)
    }

    return result
  }

  const cacheWrapDedup = <T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> =>
    singleflight(key, () => cacheWrap(key, ttl, fn))

  return {
    cacheGet,
    cacheSet,
    cacheDel,
    cacheDelPattern,
    cacheWrap,
    cacheWrapDedup,
  }
}
