import { config } from '../config/index.js'
import { logger } from './logger.js'
import { redisClient } from './redis.js'

// Written once telemetry has had a broker session, with the client id it had. Redis keeps it across
// telemetry restarts, so a broker that answers without a session tells a lost queue from a first start.
const SESSION_KEY = 'mqtt:session'

// A session that expired, or a broker that lost it, takes the queued messages with it, and the broker
// counts none of them as dropped
export const checkSession = async (sessionPresent: boolean): Promise<void> => {
  let previousClientId: string | null
  try {
    previousClientId = await redisClient.set(SESSION_KEY, config.MQTT_CLIENT_ID, 'GET')
  } catch (err) {
    logger.warn('MQTT session check unavailable', {
      event: 'mqtt.session.check_failed',
      error: err instanceof Error ? err.message : err,
    })
    return
  }
  if (sessionPresent || previousClientId === null) return
  logger.error('MQTT broker session lost', {
    event: 'mqtt.session.lost',
    clientId: config.MQTT_CLIENT_ID,
    previousClientId,
  })
}
