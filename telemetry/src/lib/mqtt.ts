import mqtt, { type MqttClient } from 'mqtt'
import { config } from '../config/index.js'
import { logger } from './logger.js'
import { checkDroppedMessages } from './mqtt-dropped.js'

const DROPPED_MESSAGES_TOPIC = '$SYS/broker/publish/messages/dropped'

let client: MqttClient | null = null

// The handler is attached before the client connects: right after the CONNACK, and before the
// subscriptions are confirmed, the broker sends the messages it queued while telemetry was down
export const initMqtt = async (
  onMessage: (topic: string, payload: Buffer) => void,
): Promise<void> => {
  const { MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_CLIENT_ID, MQTT_SESSION_EXPIRY_SECONDS } =
    config

  // The broker queues messages for the session under its client id, so the id stays the same
  // across restarts and the session outlives the outage
  client = mqtt.connect(MQTT_URL, {
    clientId: MQTT_CLIENT_ID,
    protocolVersion: 5,
    clean: false,
    connectTimeout: 30_000,
    reconnectPeriod: 10_000,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    properties: {
      sessionExpiryInterval: MQTT_SESSION_EXPIRY_SECONDS,
      receiveMaximum: 2500,
    },
  })
  client.on('message', (topic, payload) => {
    if (topic === DROPPED_MESSAGES_TOPIC) {
      void checkDroppedMessages(Number(payload.toString()))
      return
    }
    onMessage(topic, payload)
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('MQTT connection timeout'))
    }, 30_000)

    client!.on('connect', () => {
      clearTimeout(timeout)
      logger.info('MQTT connected', { event: 'mqtt.connected', broker: MQTT_URL })

      client!.subscribe(
        {
          'devices/+/nodes/+': { qos: 1 },
          'discovery/+/manifest': { qos: 1 },
          'discovery/+/status': { qos: 1 },
          // QoS 0, so no counter update waits in telemetry's queue while it is down: once the
          // queue is full, that update would be dropped and counted as well. Each subscribe
          // brings the retained current value instead.
          [DROPPED_MESSAGES_TOPIC]: { qos: 0 },
        },
        err => {
          if (err) {
            logger.error('MQTT subscribe failed', {
              event: 'mqtt.subscribe.failed',
              error: err.message,
            })
            return reject(err)
          }
          logger.info('MQTT subscribed to topics', { event: 'mqtt.subscribed' })
          resolve()
        },
      )
    })

    client!.on('error', err => {
      logger.error('MQTT error', { event: 'mqtt.error', error: err.message })
    })

    client!.on('reconnect', () => {
      logger.warn('MQTT reconnecting', { event: 'mqtt.reconnecting' })
    })

    client!.on('offline', () => {
      logger.warn('MQTT offline', { event: 'mqtt.offline' })
    })
  })
}

export const getMqttClient = (): MqttClient => {
  if (!client) throw new Error('MQTT client not initialized')
  return client
}

export const closeMqtt = async (): Promise<void> => {
  if (client) {
    await client.endAsync()
    logger.info('MQTT disconnected', { event: 'mqtt.disconnected' })
  }
}
