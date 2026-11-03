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

// A developer's local .env stays out, so the tests decide the client id and session settings
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

// Telemetry builds its Redis clients and reads MQTT_URL when their modules load, so Redis and the
// broker run before the imports above are evaluated. The broker publishes its $SYS values every
// second instead of every 10 s, and holds at most 5 messages for a client that is away.
const { redis, broker } = await vi.hoisted(async () => {
  const { composeImage, startRedisTestContainer } = await import('@mes/testing')
  const { GenericContainer, Wait } = await import('testcontainers')
  const brokerConfig = [
    'listener 1883',
    'allow_anonymous true',
    'sys_interval 1',
    'max_queued_messages 5',
    '',
  ].join('\n')
  const [redis, broker] = await Promise.all([
    startRedisTestContainer(),
    new GenericContainer(composeImage('mosquitto'))
      .withExposedPorts(1883)
      .withCopyContentToContainer([
        { content: brokerConfig, target: '/mosquitto/config/mosquitto.conf' },
      ])
      .withWaitStrategy(Wait.forLogMessage(/running/))
      .start(),
  ])
  process.env.REDIS_URL = redis.url
  process.env.MQTT_URL = `mqtt://127.0.0.1:${broker.getMappedPort(1883)}`
  return { redis, broker }
})

const DROPPED_TOPIC = '$SYS/broker/publish/messages/dropped'
const BASELINE_KEY = 'mqtt:dropped-baseline'
const DROPPED_EVENT = 'mqtt.broker.messages_dropped'

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
async function publish(topic: string, payloads: string[]) {
  const plc = await mqtt.connectAsync(config.MQTT_URL, { protocolVersion: 5 })
  for (const payload of payloads) await plc.publishAsync(topic, payload, { qos: 1 })
  await plc.endAsync()
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
  await Promise.all([redis.stop(), broker.stop()])
})

beforeEach(() => {
  received = []
  error = vi.spyOn(logger, 'error')
  warn = vi.spyOn(logger, 'warn')
  info = vi.spyOn(logger, 'info')
})

// Every test starts as a first start: no baseline a test before it left behind
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await closeMqtt()
  await redisClient.del(BASELINE_KEY)
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

describe('TelemetryConfig.mqttSession', () => {
  it('defaults the client id and a 30-minute session', async () => {
    await initMqtt(onMessage)

    expect(getMqttClient().options).toMatchObject({
      clientId: 'aimes-telemetry',
      clean: false,
      properties: { sessionExpiryInterval: 1800 },
    })
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
})
