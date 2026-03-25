/**
 * Redis-backed cache utility — thin wrapper over @mes/cache.
 *
 * Binds the shared cache functions to this service's Redis client and logger.
 * Key format: ioredis uses `keyPrefix: 'prod:'`,
 * so a key like `state:abc123` becomes `prod:state:abc123` in Redis.
 */

import { setupCache } from '@mes/cache'
import { logger } from './logger.js'
import { redisClient } from './redis.js'

const cache = setupCache(redisClient, logger)

export const { cacheGet, cacheSet, cacheDel, cacheDelPattern, cacheWrap, cacheWrapDedup } = cache
