import { createRedisClient } from '@mes/cache'
import { config } from '../config/index.js'
import { logger } from './logger.js'

// Realtime keeps no cache of its own. Neither client uses a prefix, because the auth context
// cache and the streams are shared with the other services.
export const streamClient = createRedisClient(config.REDIS_URL, { name: 'stream', logger })
export const sharedClient = createRedisClient(config.REDIS_URL, { name: 'shared', logger })

export async function initRedis(): Promise<void> {
  await Promise.all([streamClient.connect(), sharedClient.connect()])
  logger.info('Redis clients connected', { event: 'redis.init.completed' })
}

export async function closeRedis(): Promise<void> {
  await Promise.all([streamClient.quit(), sharedClient.quit()])
  logger.info('Redis clients disconnected', { event: 'redis.close.completed' })
}
