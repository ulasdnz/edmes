import mqtt, { type MqttClient } from 'mqtt'
import { config } from '../config/index.js'
import { logger } from './logger.js'

let client: MqttClient | null = null

export const initMqtt = async (): Promise<void> => {
  const { MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD } = config

  client = mqtt.connect(MQTT_URL, {
    clientId: `aimes-telemetry-${process.pid}`,
    protocolVersion: 5,
    clean: false,
    connectTimeout: 30_000,
    reconnectPeriod: 10_000,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    properties: {
      sessionExpiryInterval: 300,
      receiveMaximum: 2500,
    },
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('MQTT connection timeout'))
    }, 30_000)

    client!.on('connect', () => {
      clearTimeout(timeout)
      logger.info('MQTT connected', { event: 'mqtt.connected', broker: MQTT_URL })

      client!.subscribe(
        ['devices/+/nodes/+', 'discovery/+/manifest', 'discovery/+/status'],
        { qos: 1 },
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

export const onMqttMessage = (handler: (topic: string, payload: Buffer) => void): void => {
  if (!client) throw new Error('MQTT client not initialized')
  client.on('message', handler)
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
