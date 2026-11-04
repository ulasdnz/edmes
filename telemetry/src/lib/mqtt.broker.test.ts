import { setupMongoTestContainer } from '@mes/testing'
import mongoose from 'mongoose'
import mqtt from 'mqtt'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'
import { config } from '../config/index.js'
import { logger } from './logger.js'
import { closeMqtt, getMqttClient, initMqtt } from './mqtt.js'
import { checkDroppedMessages } from './mqtt-dropped.js'
import { closeRedis, initRedis, redisClient, sharedClient } from './redis.js'

// Telemetry builds its Redis clients and reads MQTT_URL when their modules load, so Redis and the
// brokers run before the imports above are evaluated. Both brokers publish their $SYS values every
// second instead of every 10 s. The first holds at most 5 messages for a client that is away; the
// second queues without a message limit, as the repository's broker does.
const { redis, broker, queueingBroker } = await vi.hoisted(async () => {
  const { composeImage, startRedisTestContainer } = await import('@mes/testing')
  const { GenericContainer, Wait } = await import('testcontainers')
  const startBroker = (queueLimit: string) =>
    new GenericContainer(composeImage('mosquitto'))
      .withExposedPorts(1883)
      .withCopyContentToContainer([
        {
          content: ['listener 1883', 'allow_anonymous true', 'sys_interval 1', queueLimit, ''].join(
            '\n',
          ),
          target: '/mosquitto/config/mosquitto.conf',
        },
      ])
      .withWaitStrategy(Wait.forLogMessage(/running/))
      .start()
  const [redis, broker, queueingBroker] = await Promise.all([
    startRedisTestContainer(),
    startBroker('max_queued_messages 5'),
    startBroker('max_queued_messages 0'),
  ])
  process.env.REDIS_URL = redis.url
  process.env.MQTT_URL = `mqtt://127.0.0.1:${broker.getMappedPort(1883)}`
  return { redis, broker, queueingBroker }
})

// The stores of the intake tests write to a real MongoDB
setupMongoTestContainer()

const QUEUEING_BROKER_URL = `mqtt://127.0.0.1:${queueingBroker.getMappedPort(1883)}`
const DROPPED_TOPIC = '$SYS/broker/publish/messages/dropped'
const STORED_TOPIC = '$SYS/broker/store/messages/count'
const BASELINE_KEY = 'mqtt:dropped-baseline'
const SESSION_KEY = 'mqtt:session'
const DROPPED_EVENT = 'mqtt.broker.messages_dropped'
const SESSION_LOST_EVENT = 'mqtt.session.lost'

let error: MockInstance
let warn: MockInstance
let info: MockInstance

const logged = (spy: MockInstance, event: string) =>
  spy.mock.calls.map(([, meta]) => meta).filter(meta => meta?.event === event)

let received: { topic: string; payload: string }[] = []
const onMessage = (topic: string, payload: Buffer) => {
  received.push({ topic, payload: payload.toString() })
}
const payloadsOn = (topic: string) => received.filter(m => m.topic === topic).map(m => m.payload)

// A machine that publishes while telemetry is away
async function publish(topic: string, payloads: string[], url = config.MQTT_URL) {
  const plc = await mqtt.connectAsync(url, { protocolVersion: 5 })
  for (const payload of payloads) await plc.publishAsync(topic, payload, { qos: 1 })
  await plc.endAsync()
}

// The broker forgets telemetry's session, as one restarted without its persistence file does: a client
// with the same id takes the session over with a clean start and leaves
async function brokerForgetsSession() {
  const takeover = await mqtt.connectAsync(config.MQTT_URL, {
    clientId: config.MQTT_CLIENT_ID,
    protocolVersion: 5,
    clean: true,
  })
  await takeover.endAsync()
}

// The number of messages in a broker's store, as an operator subscribed to $SYS sees it
async function watchStoredCount(url: string) {
  const observer = await mqtt.connectAsync(url, { protocolVersion: 5 })
  let latest: number | undefined
  observer.on('message', (_topic, payload) => {
    latest = Number(payload.toString())
  })
  await observer.subscribeAsync(STORED_TOPIC, { qos: 0 })
  await vi.waitFor(() => expect(latest).toBeDefined())
  return { latest: () => latest as number, close: () => observer.endAsync() }
}

// A store that writes each message to MongoDB once the test opens its gate, and counts the stores in
// progress. `fails` names payloads whose store fails after the gate opens.
function slowStore(fails: string[] = []) {
  let open = () => {}
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  const handed: string[] = []
  let inProgress = 0
  let most = 0
  return {
    handed,
    inProgress: () => inProgress,
    most: () => most,
    open: () => open(),
    async store(_topic: string, payload: Buffer) {
      const value = payload.toString()
      handed.push(value)
      inProgress++
      most = Math.max(most, inProgress)
      try {
        await gate
        if (fails.includes(value)) throw new Error(`store of ${value} failed`)
        await mongoose.connection.collection('intake_samples').insertOne({ value })
      } finally {
        inProgress--
      }
    },
  }
}

const storedValues = async () =>
  (await mongoose.connection.collection('intake_samples').find().toArray()).map(doc => doc.value)

// Telemetry's modules loaded again with the given environment, against the queueing broker
async function telemetryWith(env: Record<string, string>) {
  vi.stubEnv('MQTT_URL', QUEUEING_BROKER_URL)
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  vi.resetModules()
  const configured = {
    redis: await import('./redis.js'),
    mqtt: await import('./mqtt.js'),
    logger: (await import('./logger.js')).logger,
  }
  await configured.redis.initRedis()
  return {
    ...configured.mqtt,
    logger: configured.logger,
    async close() {
      await configured.mqtt.closeMqtt()
      await configured.redis.closeRedis()
    },
  }
}

// A restarted telemetry is a new process with a process id of its own
async function asNewProcess<T>(start: () => Promise<T>): Promise<T> {
  const pid = process.pid
  Object.defineProperty(process, 'pid', { value: pid + 1 })
  try {
    return await start()
  } finally {
    Object.defineProperty(process, 'pid', { value: pid })
  }
}

// The broker's dropped-message counter, as an operator subscribed to $SYS sees it
async function watchDroppedCounter() {
  const observer = await mqtt.connectAsync(config.MQTT_URL, { protocolVersion: 5 })
  let latest: number | undefined
  observer.on('message', (_topic, payload) => {
    latest = Number(payload.toString())
  })
  await observer.subscribeAsync(DROPPED_TOPIC, { qos: 0 })
  await vi.waitFor(() => expect(latest).toBeDefined())
  return { latest: () => latest as number, close: () => observer.endAsync() }
}

// Redis refuses the command for every connection of the default user
async function whileRedisRefuses<T>(command: string, fn: () => Promise<T>): Promise<T> {
  await sharedClient.call('ACL', 'SETUSER', 'default', `-${command}`)
  try {
    return await fn()
  } finally {
    await sharedClient.call('ACL', 'SETUSER', 'default', `+${command}`)
  }
}

// The config module validates the environment when it loads and exits on what it rejects
async function expectConfigRejects(variable: string) {
  vi.resetModules()
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})

  await import('../config/index.js')

  expect(exit).toHaveBeenCalledWith(1)
  expect(report).toHaveBeenCalledWith(expect.stringContaining(`- ${variable} :`))
}

beforeAll(async () => {
  await initRedis()
})

afterAll(async () => {
  await closeRedis()
  await Promise.all([redis.stop(), broker.stop(), queueingBroker.stop()])
})

beforeEach(() => {
  received = []
  error = vi.spyOn(logger, 'error')
  warn = vi.spyOn(logger, 'warn')
  info = vi.spyOn(logger, 'info')
})

// Every test starts as a first start: no baseline or session marker a test before it left behind
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await closeMqtt()
  await redisClient.del(BASELINE_KEY, SESSION_KEY)
})

describe('TelemetryMqtt.sessionAcrossRestart', () => {
  it('keeps its queue across a restart with a new process id', async () => {
    await initMqtt(onMessage)
    await closeMqtt()

    await publish('devices/plc-1/nodes/run', ['0', '1', '0'])

    await asNewProcess(() => initMqtt(onMessage))

    await vi.waitFor(() => expect(payloadsOn('devices/plc-1/nodes/run')).toEqual(['0', '1', '0']), {
      timeout: 5_000,
    })
  })
})

describe('Mqtt.droppedMessages', () => {
  it('logs how many messages the broker dropped while it was away', async () => {
    const counter = await watchDroppedCounter()
    const before = counter.latest()
    await initMqtt(onMessage)
    // Telemetry holds the broker's counter as its baseline before it goes away
    await vi.waitFor(async () => expect(await redisClient.get(BASELINE_KEY)).toBe(String(before)), {
      timeout: 5_000,
    })
    await closeMqtt()

    await publish(
      'devices/plc-1/nodes/count',
      Array.from({ length: 20 }, (_, i) => String(i)),
    )
    // The broker keeps 5 for telemetry and drops 15; telemetry is back once the counter shows them
    await vi.waitFor(() => expect(counter.latest()).toBe(before + 15), { timeout: 5_000 })
    await counter.close()

    await asNewProcess(() => initMqtt(onMessage))

    await vi.waitFor(
      () => expect(payloadsOn('devices/plc-1/nodes/count')).toEqual(['0', '1', '2', '3', '4']),
      { timeout: 5_000 },
    )
    await vi.waitFor(
      () => expect(logged(error, DROPPED_EVENT)).toEqual([{ event: DROPPED_EVENT, dropped: 15 }]),
      { timeout: 5_000 },
    )
    // Longer than the broker's $SYS interval: nothing reports the same drops again
    await new Promise(resolve => setTimeout(resolve, 1_500))
    expect(logged(error, DROPPED_EVENT)).toHaveLength(1)
  })

  it('stores the first counter it sees as its baseline and logs nothing', async () => {
    await redisClient.del(BASELINE_KEY)

    await checkDroppedMessages(42)

    expect(await redisClient.get(BASELINE_KEY)).toBe('42')
    expect(logged(error, DROPPED_EVENT)).toEqual([])
  })

  it('logs a rise above the baseline once, as the difference', async () => {
    await redisClient.set(BASELINE_KEY, '10')

    // Two subscriptions deliver the retained counter at the same time after a reconnect
    await Promise.all([checkDroppedMessages(25), checkDroppedMessages(25)])
    // The value just logged, received again
    await checkDroppedMessages(25)

    expect(logged(error, DROPPED_EVENT)).toEqual([{ event: DROPPED_EVENT, dropped: 15 }])
    expect(await redisClient.get(BASELINE_KEY)).toBe('25')
  })

  it('only moves the baseline when the counter falls, as after a broker restart', async () => {
    await redisClient.set(BASELINE_KEY, '25')

    await checkDroppedMessages(3)

    expect(logged(error, DROPPED_EVENT)).toEqual([])
    expect(await redisClient.get(BASELINE_KEY)).toBe('3')

    await checkDroppedMessages(7)

    expect(logged(error, DROPPED_EVENT)).toEqual([{ event: DROPPED_EVENT, dropped: 4 }])
  })

  it('measures drops from before a telemetry restart against the baseline stored in Redis', async () => {
    // As the process before the restart left it, under telemetry's key prefix
    await sharedClient.set('telemetry:mqtt:dropped-baseline', '100')

    await checkDroppedMessages(130)

    expect(logged(error, DROPPED_EVENT)).toEqual([{ event: DROPPED_EVENT, dropped: 30 }])
  })

  it('warns once while Redis refuses the baseline and once when it answers again', async () => {
    await redisClient.set(BASELINE_KEY, '5')

    await whileRedisRefuses('set', async () => {
      await checkDroppedMessages(6)
      await checkDroppedMessages(7)
      await checkDroppedMessages(8)
    })

    expect(logged(warn, 'mqtt.broker.dropped_check_failed')).toEqual([
      { event: 'mqtt.broker.dropped_check_failed', error: expect.stringMatching(/NOPERM/) },
    ])
    expect(logged(error, DROPPED_EVENT)).toEqual([])

    await checkDroppedMessages(9)

    expect(logged(info, 'mqtt.broker.dropped_check_recovered')).toHaveLength(1)
    // The drops counted while Redis refused are measured from the baseline it kept
    expect(logged(error, DROPPED_EVENT)).toEqual([{ event: DROPPED_EVENT, dropped: 4 }])
    expect(logged(warn, 'mqtt.broker.dropped_check_failed')).toHaveLength(1)
  })
})

// On a reconnect the broker sends queued messages ahead of the subscribe acknowledgement, so telemetry
// is connected only once it has taken them in, and these tests start the reconnect without waiting
describe('Mqtt.boundedIntake', () => {
  it('holds no more than its bound and leaves the rest of the backlog at the broker', async () => {
    const telemetry = await telemetryWith({
      MQTT_CLIENT_ID: 'bounded-telemetry',
      MQTT_MAX_UNSTORED_MESSAGES: '5',
    })
    const store = slowStore()
    try {
      await telemetry.initMqtt(store.store)
      await telemetry.closeMqtt()
      const stored = await watchStoredCount(QUEUEING_BROKER_URL)
      const before = stored.latest()
      const backlog = Array.from({ length: 50 }, (_, i) => String(i))
      await publish('devices/plc-1/nodes/count', backlog, QUEUEING_BROKER_URL)

      const reconnected = telemetry.initMqtt(store.store)

      await vi.waitFor(() => expect(store.handed).toHaveLength(5), { timeout: 5_000 })
      // Telemetry acknowledged 4 and holds back the fifth, so the broker keeps the other 46. Its store
      // also holds its retained $SYS values, of which a new one can appear in any interval.
      await vi.waitFor(() => expect(stored.latest()).toBeGreaterThanOrEqual(before + 46), {
        timeout: 5_000,
      })
      // Longer than a $SYS interval: nothing more is handed over, and the broker still keeps them
      await new Promise(resolve => setTimeout(resolve, 1_500))
      expect(store.handed).toHaveLength(5)
      expect(stored.latest()).toBeGreaterThanOrEqual(before + 46)
      await stored.close()

      store.open()
      await reconnected

      await vi.waitFor(async () => expect(await storedValues()).toHaveLength(50), {
        timeout: 10_000,
      })
      expect(store.handed).toEqual(backlog)
      expect((await storedValues()).map(Number).sort((a, b) => a - b)).toEqual(backlog.map(Number))
      expect(store.most()).toBe(5)
    } finally {
      // Closing waits for the stores, so a failed assertion must not leave them waiting
      store.open()
      await telemetry.close()
    }
  })

  it('counts every message, also when their stores wait on one promise', async () => {
    const telemetry = await telemetryWith({
      MQTT_CLIENT_ID: 'shared-store-telemetry',
      MQTT_MAX_UNSTORED_MESSAGES: '2',
    })
    let open = () => {}
    const gate = new Promise<void>(resolve => {
      open = resolve
    })
    const handed: string[] = []
    const store = (_topic: string, payload: Buffer) => {
      handed.push(payload.toString())
      return gate
    }
    try {
      await telemetry.initMqtt(store)
      await telemetry.closeMqtt()
      await publish('devices/plc-1/nodes/count', ['0', '1', '2', '3'], QUEUEING_BROKER_URL)

      const reconnected = telemetry.initMqtt(store)

      await vi.waitFor(() => expect(handed).toEqual(['0', '1']), { timeout: 5_000 })
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(handed).toEqual(['0', '1'])

      open()
      await reconnected
      await vi.waitFor(() => expect(handed).toEqual(['0', '1', '2', '3']), { timeout: 5_000 })
    } finally {
      open()
      await telemetry.close()
    }
  })

  it('frees the place of a store that fails', async () => {
    const telemetry = await telemetryWith({
      MQTT_CLIENT_ID: 'failing-store-telemetry',
      MQTT_MAX_UNSTORED_MESSAGES: '1',
    })
    const store = slowStore(['0'])
    try {
      await telemetry.initMqtt(store.store)
      await telemetry.closeMqtt()
      await publish('devices/plc-1/nodes/count', ['0', '1', '2'], QUEUEING_BROKER_URL)

      const reconnected = telemetry.initMqtt(store.store)

      await vi.waitFor(() => expect(store.handed).toEqual(['0']), { timeout: 5_000 })
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(store.handed).toEqual(['0'])

      store.open()
      await reconnected

      await vi.waitFor(() => expect(store.handed).toEqual(['0', '1', '2']), { timeout: 5_000 })
      await vi.waitFor(async () => expect(await storedValues()).toEqual(['1', '2']), {
        timeout: 5_000,
      })
    } finally {
      store.open()
      await telemetry.close()
    }
  })

  it('lets the stores in progress finish before it closes', async () => {
    const telemetry = await telemetryWith({
      MQTT_CLIENT_ID: 'closing-telemetry',
      MQTT_MAX_UNSTORED_MESSAGES: '5',
    })
    const store = slowStore()
    try {
      await telemetry.initMqtt(store.store)
      await telemetry.closeMqtt()
      await publish('devices/plc-1/nodes/count', ['0', '1', '2'], QUEUEING_BROKER_URL)
      await telemetry.initMqtt(store.store)
      await vi.waitFor(() => expect(store.inProgress()).toBe(3), { timeout: 5_000 })

      let closed = false
      const closing = telemetry.closeMqtt().then(() => {
        closed = true
      })
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(closed).toBe(false)

      store.open()
      await closing

      expect(await storedValues()).toHaveLength(3)
    } finally {
      store.open()
      await telemetry.close()
    }
  })
})

describe('TelemetryMqtt.close', () => {
  it('takes nothing in once it closes, and the broker delivers the rest again', async () => {
    const telemetry = await telemetryWith({ MQTT_CLIENT_ID: 'closing-mid-burst-telemetry' })
    const error = vi.spyOn(telemetry.logger, 'error')
    const handed: string[] = []
    const store = async (_topic: string, payload: Buffer) => {
      handed.push(payload.toString())
    }
    const plc = await mqtt.connectAsync(QUEUEING_BROKER_URL, { protocolVersion: 5 })
    const published: string[] = []
    try {
      // A machine publishes fast while telemetry closes, so messages still arrive after telemetry
      // has told the broker it disconnects. The race is narrow, so it runs a few times.
      for (let round = 0; round < 5; round++) {
        await telemetry.initMqtt(store)
        const burst = Array.from({ length: 2000 }, (_, i) => `${round}-${i}`)
        published.push(...burst)
        const publishing = (async () => {
          for (let i = 0; i < burst.length; i += 100) {
            await Promise.all(
              burst
                .slice(i, i + 100)
                .map(payload => plc.publishAsync('devices/plc-1/nodes/count', payload, { qos: 1 })),
            )
          }
        })()
        await vi.waitFor(
          () => expect(handed.filter(p => p.startsWith(`${round}-`)).length).toBeGreaterThan(300),
          { timeout: 10_000 },
        )

        const takenBeforeClosing = handed.length
        await telemetry.closeMqtt()
        expect(handed.length).toBe(takenBeforeClosing)
        await publishing
      }
      expect(logged(error, 'mqtt.error')).toEqual([])

      await telemetry.initMqtt(store)
      await vi.waitFor(() => expect(new Set(handed).size).toBe(published.length), {
        timeout: 20_000,
      })
    } finally {
      await plc.endAsync()
      await telemetry.close()
    }
  })
})

describe('Mqtt.sessionLost', () => {
  it('logs nothing on its first connect ever, and marks that it has a session', async () => {
    await brokerForgetsSession()

    await initMqtt(onMessage)

    expect(await redisClient.get(SESSION_KEY)).not.toBeNull()
    expect(logged(error, SESSION_LOST_EVENT)).toEqual([])
  })

  it('logs nothing when the broker kept its session', async () => {
    await initMqtt(onMessage)
    await closeMqtt()

    await asNewProcess(() => initMqtt(onMessage))

    expect(logged(error, SESSION_LOST_EVENT)).toEqual([])
  })

  it('logs a lost session when the broker no longer has the one it had', async () => {
    await initMqtt(onMessage)
    await closeMqtt()
    await brokerForgetsSession()

    await asNewProcess(() => initMqtt(onMessage))

    expect(logged(error, SESSION_LOST_EVENT)).toEqual([
      {
        event: SESSION_LOST_EVENT,
        clientId: 'aimes-telemetry',
        previousClientId: 'aimes-telemetry',
      },
    ])
  })
})

describe('TelemetryConfig.mqttSession', () => {
  it('defaults the client id, a one-day session and an intake bound of 20', async () => {
    await initMqtt(onMessage)

    expect(getMqttClient().options).toMatchObject({
      clientId: 'aimes-telemetry',
      clean: false,
      properties: { sessionExpiryInterval: 86400 },
    })
    expect(config.MQTT_MAX_UNSTORED_MESSAGES).toBe(20)
  })

  it('connects with the configured client id and session expiry', async () => {
    vi.stubEnv('MQTT_CLIENT_ID', 'line-2-telemetry')
    vi.stubEnv('MQTT_SESSION_EXPIRY_SECONDS', '600')
    vi.resetModules()
    const configured = {
      redis: await import('./redis.js'),
      mqtt: await import('./mqtt.js'),
    }
    await configured.redis.initRedis()

    try {
      await configured.mqtt.initMqtt(onMessage)

      expect(configured.mqtt.getMqttClient().options).toMatchObject({
        clientId: 'line-2-telemetry',
        clean: false,
        properties: { sessionExpiryInterval: 600 },
      })
    } finally {
      await configured.mqtt.closeMqtt()
      await configured.redis.closeRedis()
    }
  })

  it('rejects an empty MQTT_CLIENT_ID', async () => {
    vi.stubEnv('MQTT_CLIENT_ID', '')

    await expectConfigRejects('MQTT_CLIENT_ID')
  })

  it.each(['0', '-60', '1.5'])('rejects %s as MQTT_SESSION_EXPIRY_SECONDS', async value => {
    vi.stubEnv('MQTT_SESSION_EXPIRY_SECONDS', value)

    await expectConfigRejects('MQTT_SESSION_EXPIRY_SECONDS')
  })

  it.each(['0', '-5', '1.5'])('rejects %s as MQTT_MAX_UNSTORED_MESSAGES', async value => {
    vi.stubEnv('MQTT_MAX_UNSTORED_MESSAGES', value)

    await expectConfigRejects('MQTT_MAX_UNSTORED_MESSAGES')
  })
})
