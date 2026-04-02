import { setupCache } from '@mes/cache'
import { logger } from './logger.js'
import { redisClient, sharedClient } from './redis.js'

const cache = setupCache(redisClient, logger)
const shared = setupCache(sharedClient, logger)

export const { cacheGet, cacheSet, cacheDel, cacheDelPattern, cacheWrap, cacheWrapDedup } = cache
export const { cacheWrapDedup: sharedCacheWrapDedup, cacheDel: sharedCacheDel } = shared
