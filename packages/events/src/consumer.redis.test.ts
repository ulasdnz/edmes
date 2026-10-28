import { Redis } from 'ioredis'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createStreamConsumer } from './consumer.js'
import { publishEvent } from './publish.js'

const STREAM = 'events.test'
const GROUP = 'test-group'

const logger = { info: () => {}, warn: () => {}, error: () => {} }

let container: StartedTestContainer
let redis: Redis

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start()
  redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379) })
}, 120_000)

afterAll(async () => {
  await redis?.quit()
  await container?.stop()
})

beforeEach(async () => {
  await redis.flushall()
  // Group starts at '0' so events published before start() are delivered.
  await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM')
})

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`)
}

async function pendingCount(): Promise<number> {
  const [count] = (await redis.xpending(STREAM, GROUP)) as [number, ...unknown[]]
  return count
}

describe('createStreamConsumer against real Redis', () => {
  it('retries a failed event while running, without a restart', async () => {
    let attempts = 0
    const consumer = createStreamConsumer({
      redis,
      group: GROUP,
      consumer: 'consumer-1',
      streams: {
        [STREAM]: {
          'foo.bar': async () => {
            attempts++
            if (attempts === 1) throw new Error('transient failure')
          },
        },
      },
      logger,
      pollIntervalMs: 20,
      reclaimMinIdleMs: 50,
      reclaimIntervalMs: 50,
    })

    await publishEvent(redis, STREAM, 'foo.bar', { x: 1 })
    const running = consumer.start()

    try {
      await waitFor(() => attempts >= 2)
      await waitFor(async () => (await pendingCount()) === 0)
    } finally {
      await consumer.stop()
      await running
    }

    expect(attempts).toBe(2)
  }, 15_000)

  it('dead-letters an event that keeps failing, without a restart', async () => {
    let attempts = 0
    const consumer = createStreamConsumer({
      redis,
      group: GROUP,
      consumer: 'consumer-1',
      streams: {
        [STREAM]: {
          'foo.bar': async () => {
            attempts++
            throw new Error('boom')
          },
        },
      },
      logger,
      pollIntervalMs: 20,
      reclaimMinIdleMs: 50,
      reclaimIntervalMs: 50,
      maxDeliveries: 3,
    })

    await publishEvent(redis, STREAM, 'foo.bar', { x: 1 })
    const running = consumer.start()

    try {
      await waitFor(async () => (await redis.xlen(`${STREAM}.dlq`)) === 1)
      await waitFor(async () => (await pendingCount()) === 0)
    } finally {
      await consumer.stop()
      await running
    }

    expect(attempts).toBe(3)
    const [[, fields]] = await redis.xrange(`${STREAM}.dlq`, '-', '+')
    const data = JSON.parse(fields[fields.indexOf('data') + 1])
    expect(data).toEqual(
      expect.objectContaining({
        originalStream: STREAM,
        data: { x: 1 },
        error: 'boom',
        deliveries: 3,
      }),
    )
  }, 15_000)

  it('takes over events left pending by a crashed peer while running', async () => {
    const handled: string[] = []

    // A peer reads the event and dies before ACKing it.
    await publishEvent(redis, STREAM, 'foo.bar', { x: 1 })
    await redis.xreadgroup('GROUP', GROUP, 'crashed-peer', 'COUNT', 10, 'STREAMS', STREAM, '>')

    const consumer = createStreamConsumer({
      redis,
      group: GROUP,
      consumer: 'consumer-1',
      streams: {
        [STREAM]: {
          'foo.bar': async (_data, type) => {
            handled.push(type)
          },
        },
      },
      logger,
      pollIntervalMs: 20,
      // Longer than the startup pass takes, so only the runtime pass can claim it.
      reclaimMinIdleMs: 300,
      reclaimIntervalMs: 50,
    })

    const running = consumer.start()

    try {
      await waitFor(async () => (await pendingCount()) === 0)
    } finally {
      await consumer.stop()
      await running
    }

    expect(handled).toEqual(['foo.bar'])
  }, 15_000)
})
