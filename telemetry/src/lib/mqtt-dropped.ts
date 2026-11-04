import { logger } from './logger.js'
import { redisClient } from './redis.js'

// The broker's dropped-message counter as telemetry saw it last. Redis keeps it across telemetry
// restarts, so drops that happened while telemetry was down are reported once it is back.
const BASELINE_KEY = 'mqtt:dropped-baseline'

let baselineFailing = false

export const checkDroppedMessages = async (counter: number): Promise<void> => {
  let baseline: string | null
  try {
    // One command reads the last baseline and stores the new one, so a counter that arrives twice
    // at once is reported once
    baseline = await redisClient.set(BASELINE_KEY, counter, 'GET')
  } catch (err) {
    if (!baselineFailing) {
      baselineFailing = true
      logger.warn('MQTT dropped-message baseline unavailable', {
        event: 'mqtt.broker.dropped_check_failed',
        error: err instanceof Error ? err.message : err,
      })
    }
    return
  }
  if (baselineFailing) {
    baselineFailing = false
    logger.info('MQTT dropped-message baseline available again', {
      event: 'mqtt.broker.dropped_check_recovered',
    })
  }

  // No baseline yet: a first start has no outage of its own to report. A lower counter: the broker
  // restarted and counts from zero again.
  if (baseline === null || counter <= Number(baseline)) return
  logger.error('MQTT broker dropped messages', {
    event: 'mqtt.broker.messages_dropped',
    dropped: counter - Number(baseline),
  })
}
