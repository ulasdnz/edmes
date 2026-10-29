import { createRedisClient } from '@mes/cache'
import { config } from '../config/index.js'
import { logger } from './logger.js'

// Service-local cache keys carry the service prefix. The shared client (auth context cache) and
// the stream client use none, because other services read the same keys and streams.
export const redisClient = createRedisClient(config.REDIS_URL, {
  name: 'cache',
  keyPrefix: 'telemetry:',
  logger,
})
export const sharedClient = createRedisClient(config.REDIS_URL, { name: 'shared', logger })
export const streamClient = createRedisClient(config.REDIS_URL, { name: 'stream', logger })

export const initRedis = async () => {
  await Promise.all([redisClient.connect(), sharedClient.connect(), streamClient.connect()])
  logger.info('Redis clients connected', { event: 'redis.init.completed' })
}

export const closeRedis = async () => {
  await Promise.all([redisClient.quit(), sharedClient.quit(), streamClient.quit()])
}
