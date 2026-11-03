import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import mongoose, { Types } from 'mongoose'
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
import { config } from '../../config/index.js'
import { initLoaders, stopIngestionRetries } from '../../core/loaders/index.js'
import { logger } from '../../lib/logger.js'
import { closeMqtt } from '../../lib/mqtt.js'
import { closeRedis } from '../../lib/redis.js'
import Tag from '../tag/tag.model.js'

// A developer's local .env stays out, so the tests decide every address and setting
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

// Telemetry reads its MongoDB, Redis and broker addresses when its modules load, so all three run
// before the imports above are evaluated. MongoDB is a standalone server, as under compose, bound to a
// fixed host port so that it comes back at the same address after a stop and a start. The broker
// queues without a message limit, as the repository's broker does, and publishes its $SYS values
// every second. Telemetry takes in at most 5 messages it has not stored.
const { mongo, redis, broker } = await vi.hoisted(async () => {
  const { createServer } = await import('node:net')
  const { composeImage, MONGO_IMAGE, startRedisTestContainer } = await import('@mes/testing')
  const { GenericContainer, Wait } = await import('testcontainers')
  const port = await new Promise<number>(resolve => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
  const [mongo, redis, broker] = await Promise.all([
    new GenericContainer(MONGO_IMAGE)
      .withExposedPorts({ container: 27017, host: port })
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start(),
    startRedisTestContainer(),
    new GenericContainer(composeImage('mosquitto'))
      .withExposedPorts(1883)
      .withCopyContentToContainer([
        {
          content: [
            'listener 1883',
            'allow_anonymous true',
            'sys_interval 1',
            'max_queued_messages 0',
            '',
          ].join('\n'),
          target: '/mosquitto/config/mosquitto.conf',
        },
      ])
      .withWaitStrategy(Wait.forLogMessage(/running/))
      .start(),
  ])
  process.env.MONGO_URI = `mongodb://127.0.0.1:${port}/mes_telemetry?directConnection=true`
  process.env.REDIS_URL = redis.url
  process.env.MQTT_URL = `mqtt://127.0.0.1:${broker.getMappedPort(1883)}`
  process.env.MQTT_MAX_UNSTORED_MESSAGES = '5'
  return { mongo, redis, broker }
})

const docker = (...args: string[]) => promisify(execFile)('docker', args)

const COUNT_TOPIC = 'devices/plc-1/nodes/count'
const SPEED_TOPIC = 'devices/plc-1/nodes/speed'
const STORED_TOPIC = '$SYS/broker/store/messages/count'

const countTagId = new Types.ObjectId()
const speedTagId = new Types.ObjectId()

const START = Date.UTC(2026, 3, 1, 8, 0, 0)
const sample = (second: number, value = second) =>
  JSON.stringify({ time: new Date(START + second * 1000).toISOString(), value })
const seconds = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)

const samples = (tagId: Types.ObjectId) =>
  mongoose.connection.collection(`tag_samples_${tagId}`).find().sort({ _id: 1 }).toArray()

let error: MockInstance
let warn: MockInstance
let info: MockInstance

const logged = (spy: MockInstance, event: string) =>
  spy.mock.calls.map(([, meta]) => meta).filter(meta => meta?.event === event)

// A machine that publishes its samples while telemetry runs
async function publish(topic: string, payloads: string[]) {
  const plc = await mqtt.connectAsync(config.MQTT_URL, { protocolVersion: 5 })
  for (const payload of payloads) await plc.publishAsync(topic, payload, { qos: 1 })
  await plc.endAsync()
}

// The number of messages in the broker's store, as an operator subscribed to $SYS sees it
async function watchStoredCount() {
  const observer = await mqtt.connectAsync(config.MQTT_URL, { protocolVersion: 5 })
  let latest: number | undefined
  observer.on('message', (_topic, payload) => {
    latest = Number(payload.toString())
  })
  await observer.subscribeAsync(STORED_TOPIC, { qos: 0 })
  await vi.waitFor(() => expect(latest).toBeDefined())
  return {
    latest: () => latest as number,
    // The broker publishes the count only when it changed, at most once a second: once a second has
    // passed, the latest value is the count now
    settled: async () => {
      await new Promise(resolve => setTimeout(resolve, 1_500))
      return latest as number
    },
    close: () => observer.endAsync(),
  }
}

let stored: Awaited<ReturnType<typeof watchStoredCount>>

beforeAll(async () => {
  await initLoaders()
  // Two bound tags telemetry has not looked up yet
  await Tag.collection.insertMany([
    {
      _id: countTagId,
      name: 'count',
      tagTypeId: new Types.ObjectId(),
      behavior: 'counter',
      tolerance: 0,
      binding: { deviceKey: 'plc-1', nodeId: 'count' },
    },
    {
      _id: speedTagId,
      name: 'speed',
      tagTypeId: new Types.ObjectId(),
      behavior: 'speed',
      tolerance: 0,
      binding: { deviceKey: 'plc-1', nodeId: 'speed' },
    },
  ])
  // MongoDB rejects a count of 666: a failure that no wait cures
  await mongoose.connection.db?.createCollection(`tag_samples_${countTagId}`, {
    validator: { value: { $ne: 666 } },
  })
  stored = await watchStoredCount()
})

afterAll(async () => {
  await stored.close()
  stopIngestionRetries()
  await closeMqtt()
  // Back up, so that Mongoose closes its connection at once
  await docker('start', mongo.getId())
  await mongoose.disconnect()
  await closeRedis()
  await Promise.all([mongo.stop(), redis.stop(), broker.stop()])
})

beforeEach(() => {
  error = vi.spyOn(logger, 'error')
  warn = vi.spyOn(logger, 'warn')
  info = vi.spyOn(logger, 'info')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// docker stop and start reproduce MongoDB being down: its connections close, new ones are refused, and
// every operation fails with the driver's network and server-selection errors until it is back. A
// paused container would test a MongoDB that hangs instead, which this group does not cover.
describe('Ingestion.mongoUnreachable', () => {
  it('stores every message once and in order when MongoDB stops and starts again', async () => {
    // MongoDB up: the count tag is looked up and its counts stored, and the count MongoDB rejects is
    // dropped with an error line
    await publish(COUNT_TOPIC, [...seconds(1, 50).map(s => sample(s)), sample(51, 666)])
    await vi.waitFor(
      async () => {
        expect(await samples(countTagId)).toHaveLength(50)
        expect(logged(error, 'ingestion.error')).toHaveLength(1)
      },
      { timeout: 15_000 },
    )

    const before = await stored.settled()
    await docker('stop', mongo.getId())

    // MongoDB down: two counts of the tag telemetry looked up, the speeds of the tag it has not looked
    // up yet, then the rest of the counts
    await publish(COUNT_TOPIC, [sample(52), sample(53)])
    await publish(
      SPEED_TOPIC,
      seconds(1, 20).map(s => sample(s)),
    )
    await publish(
      COUNT_TOPIC,
      seconds(54, 251).map(s => sample(s)),
    )

    // Telemetry takes in no more than its bound, and the broker holds the rest
    await vi.waitFor(() => expect(stored.latest()).toBeGreaterThanOrEqual(before + 220 - 5), {
      timeout: 10_000,
    })
    // The count's store and the speed tag's lookup wait for MongoDB, and no message is dropped
    await vi.waitFor(
      () =>
        expect(
          logged(warn, 'ingestion.store.deferred')
            .map(meta => meta.topic)
            .sort(),
        ).toEqual([COUNT_TOPIC, SPEED_TOPIC]),
      { timeout: 30_000 },
    )
    // MongoDB stays down while the store tries again, with a growing pause between tries
    await new Promise(resolve => setTimeout(resolve, 15_000))
    expect(logged(error, 'ingestion.error')).toHaveLength(1)

    await docker('start', mongo.getId())

    await vi.waitFor(
      async () => {
        expect(await samples(countTagId)).toHaveLength(250)
        expect(await samples(speedTagId)).toHaveLength(20)
      },
      { timeout: 90_000, interval: 500 },
    )

    // Each count stored once, in the order published, and linked to the count stored before it
    const counts = await samples(countTagId)
    expect(counts.map(doc => doc.value)).toEqual([...seconds(1, 50), ...seconds(52, 251)])
    for (const [i, doc] of counts.slice(1).entries()) {
      expect(doc.prevTs).toEqual(counts[i].occurredAt)
    }
    expect((await samples(speedTagId)).map(doc => doc.value)).toEqual(seconds(1, 20))

    expect(logged(error, 'ingestion.error')).toEqual([
      expect.objectContaining({
        topic: COUNT_TOPIC,
        error: expect.stringContaining('Document failed validation'),
      }),
    ])
    // One warn when a message first waits, however many times it tried, and one info once it is stored
    expect(logged(warn, 'ingestion.store.deferred')).toHaveLength(2)
    const resolved = logged(info, 'ingestion.store.resolved')
    expect(resolved.map(meta => meta.topic).sort()).toEqual([COUNT_TOPIC, SPEED_TOPIC])
    for (const meta of resolved) expect(meta.waitedMs).toBeGreaterThan(0)
    expect(resolved.find(meta => meta.topic === COUNT_TOPIC).failedAttempts).toBeGreaterThan(1)
  }, 180_000)

  it('stops waiting for MongoDB when telemetry stops', async () => {
    const before = await stored.settled()
    await docker('stop', mongo.getId())

    await publish(
      COUNT_TOPIC,
      seconds(300, 319).map(s => sample(s)),
    )
    await vi.waitFor(() => expect(logged(warn, 'ingestion.store.deferred')).toHaveLength(1), {
      timeout: 30_000,
    })
    await vi.waitFor(() => expect(stored.latest()).toBeGreaterThanOrEqual(before + 20 - 5), {
      timeout: 10_000,
    })
    // The first store tries again 1 s after it failed, and the driver waits 5 s for a server before
    // that try fails: telemetry stops during it
    await new Promise(resolve => setTimeout(resolve, 2_000))

    // Telemetry's shutdown: the waits stop, then the MQTT connection closes
    const stopping = performance.now()
    stopIngestionRetries()
    await closeMqtt()
    expect(performance.now() - stopping).toBeLessThan(2_000)

    // One error line for each message telemetry took in and did not store
    const abandoned = logged(error, 'ingestion.store.abandoned')
    expect(abandoned).toHaveLength(config.MQTT_MAX_UNSTORED_MESSAGES)
    for (const meta of abandoned) {
      expect(meta.topic).toBe(COUNT_TOPIC)
      expect(meta.waitedMs).toBeGreaterThan(0)
    }
    expect(logged(error, 'ingestion.error')).toHaveLength(0)
  }, 120_000)
})
