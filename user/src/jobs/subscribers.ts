import { logger } from '../lib/logger.js'
import { subscriberClient } from '../lib/redis.js'
import departmentDeletedHandler from './handlers/department-deleted.handler.js'
import stationDeletedHandler from './handlers/station-deleted.handler.js'

/**
 * Cross-service event channels this service subscribes to.
 * Other services publish to these channels via Redis Pub/Sub.
 */
const CHANNELS = {
  'station.deleted': stationDeletedHandler,
  'department.deleted': departmentDeletedHandler,
} as const

/**
 * Initialize Redis Pub/Sub subscriptions.
 * Called once during server boot from the loaders.
 */
export const initSubscribers = async () => {
  const channels = Object.keys(CHANNELS)

  await subscriberClient.subscribe(...channels)

  subscriberClient.on('message', async (channel: string, message: string) => {
    const handler = CHANNELS[channel as keyof typeof CHANNELS]
    if (!handler) {
      logger.warn(`Received message on unknown channel: ${channel}`)
      return
    }

    try {
      const data = JSON.parse(message)
      await handler(data)
    } catch (error) {
      logger.error(`Failed to process event on channel ${channel}`, {
        error: error instanceof Error ? error.message : error,
      })
    }
  })

  logger.info(`Subscribed to Redis channels: ${channels.join(', ')}`)
}

/**
 * Gracefully unsubscribe and disconnect the subscriber client.
 * Called during server shutdown.
 */
export const shutdownSubscribers = async () => {
  await subscriberClient.unsubscribe()
  await subscriberClient.quit()
  logger.info('Redis subscriber disconnected')
}
