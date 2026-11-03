import mqtt, { type MqttClient } from 'mqtt'
import { config } from '../config/index.js'
import { logger } from './logger.js'
import { checkDroppedMessages } from './mqtt-dropped.js'
import { checkSession } from './mqtt-session.js'

const DROPPED_MESSAGES_TOPIC = '$SYS/broker/publish/messages/dropped'

let client: MqttClient | null = null

// One entry per message telemetry has received and not stored yet, settled once its store has
const unstored = new Set<Promise<void>>()
// The acknowledgement of the message telemetry holds back while it is at its bound
let heldBack: (() => void) | null = null
// Telemetry is closing: it takes nothing in and acknowledges nothing, and the broker delivers what
// still arrives again on the next connection
let closing = false

// The handler is attached before the client connects: right after the CONNACK, and before the
// subscriptions are confirmed, the broker sends the messages it queued while telemetry was down.
// Telemetry reads the confirmation only after those, so with a backlog it resolves once it has taken
// in the up to 2500 messages the broker sends ahead of it (receiveMaximum).
// A handler that returns a promise stores the message; telemetry counts it as unstored until the
// promise settles, failed or not.
export const initMqtt = async (
  onMessage: (topic: string, payload: Buffer) => unknown,
): Promise<void> => {
  const {
    MQTT_URL,
    MQTT_USERNAME,
    MQTT_PASSWORD,
    MQTT_CLIENT_ID,
    MQTT_SESSION_EXPIRY_SECONDS,
    MQTT_MAX_UNSTORED_MESSAGES,
  } = config

  closing = false
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
    if (closing) return
    if (topic === DROPPED_MESSAGES_TOPIC) {
      void checkDroppedMessages(Number(payload.toString()))
      return
    }
    const store = onMessage(topic, payload)
    if (!(store instanceof Promise)) return
    const stored = () => {
      unstored.delete(entry)
      if (heldBack && unstored.size < MQTT_MAX_UNSTORED_MESSAGES) {
        const acknowledge = heldBack
        heldBack = null
        acknowledge()
      }
    }
    const entry = store.then(stored, stored)
    unstored.add(entry)
  })
  // MQTT.js acknowledges a message and reads the next one only once this callback runs. Below the
  // bound it runs at once, so stores overlap; at the bound it waits for a store to finish, and the
  // rest of the backlog stays at the broker.
  client.handleMessage = (_packet, callback) => {
    if (closing) return
    if (unstored.size < MQTT_MAX_UNSTORED_MESSAGES) {
      callback()
      return
    }
    heldBack = callback
  }
  // The message held back was not acknowledged: the broker delivers it again on the next connection
  client.on('close', () => {
    heldBack = null
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('MQTT connection timeout'))
    }, 30_000)

    client!.on('connect', connack => {
      clearTimeout(timeout)
      logger.info('MQTT connected', { event: 'mqtt.connected', broker: MQTT_URL })
      const sessionChecked = checkSession(connack.sessionPresent)

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
        async err => {
          if (err) {
            logger.error('MQTT subscribe failed', {
              event: 'mqtt.subscribe.failed',
              error: err.message,
            })
            return reject(err)
          }
          logger.info('MQTT subscribed to topics', { event: 'mqtt.subscribed' })
          await sessionChecked
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

// Stops taking messages, then lets the stores in progress finish: their messages are acknowledged
export const closeMqtt = async (): Promise<void> => {
  if (client) {
    closing = true
    heldBack = null
    await client.endAsync()
    await Promise.allSettled(unstored)
    logger.info('MQTT disconnected', { event: 'mqtt.disconnected' })
  }
}
