import { setupCache } from '@mes/cache'
import { logger } from './logger.js'
import { sharedClient } from './redis.js'

export const { cacheWrapDedup: sharedCacheWrapDedup } = setupCache(sharedClient, logger)
