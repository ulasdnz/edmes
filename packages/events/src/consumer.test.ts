import { describe, expect, it, vi } from 'vitest'
import { createStreamConsumer } from './consumer.js'

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

function makeMockRedis() {
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xack: vi.fn().mockResolvedValue(1),
    xreadgroup: vi.fn(),
  }
}

function makeMessage(id: string, type: string, data: Record<string, unknown>) {
  return [id, ['type', type, 'data', JSON.stringify(data)]] as [string, string[]]
}

describe('createStreamConsumer — catch-all handler', () => {
  it("invokes '*' handler when no specific type handler matches", async () => {
    const redis = makeMockRedis()
    const catchAll = vi.fn().mockResolvedValue(undefined)
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup
      .mockResolvedValueOnce(null) // processPending: no pending messages
      .mockResolvedValueOnce([['events.test', [makeMessage('1-0', 'foo.bar', { x: 1 })]]])
      .mockImplementationOnce(() => {
        consumer.stop()
        return Promise.resolve(null)
      })

    consumer = createStreamConsumer({
      redis: redis as any,
      group: 'test-group',
      consumer: 'test-consumer',
      streams: { 'events.test': { '*': catchAll } },
      logger: mockLogger,
      pollIntervalMs: 0,
    })

    await consumer.start()

    expect(catchAll).toHaveBeenCalledOnce()
    expect(catchAll).toHaveBeenCalledWith(expect.objectContaining({ x: 1 }), 'foo.bar')
  })

  it("passes event type as second argument to '*' handler", async () => {
    const redis = makeMockRedis()
    let receivedType: string | undefined
    const catchAll = vi.fn().mockImplementation(async (_data: unknown, type: string) => {
      receivedType = type
    })
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([
        ['events.test', [makeMessage('1-0', 'role.updated', { roleId: 'r1' })]],
      ])
      .mockImplementationOnce(() => {
        consumer.stop()
        return Promise.resolve(null)
      })

    consumer = createStreamConsumer({
      redis: redis as any,
      group: 'test-group',
      consumer: 'test-consumer',
      streams: { 'events.test': { '*': catchAll } },
      logger: mockLogger,
      pollIntervalMs: 0,
    })

    await consumer.start()

    expect(receivedType).toBe('role.updated')
  })

  it("specific type handler takes priority over '*' when both registered", async () => {
    const redis = makeMockRedis()
    const specificHandler = vi.fn().mockResolvedValue(undefined)
    const catchAll = vi.fn().mockResolvedValue(undefined)
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([
        ['events.test', [makeMessage('1-0', 'role.updated', { roleId: 'r1' })]],
      ])
      .mockImplementationOnce(() => {
        consumer.stop()
        return Promise.resolve(null)
      })

    consumer = createStreamConsumer({
      redis: redis as any,
      group: 'test-group',
      consumer: 'test-consumer',
      streams: { 'events.test': { 'role.updated': specificHandler, '*': catchAll } },
      logger: mockLogger,
      pollIntervalMs: 0,
    })

    await consumer.start()

    expect(specificHandler).toHaveBeenCalledOnce()
    expect(catchAll).not.toHaveBeenCalled()
  })

  it('passes event type as second argument to specific type handlers', async () => {
    const redis = makeMockRedis()
    const specificHandler = vi.fn().mockResolvedValue(undefined)
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([
        ['events.test', [makeMessage('1-0', 'role.updated', { roleId: 'r2' })]],
      ])
      .mockImplementationOnce(() => {
        consumer.stop()
        return Promise.resolve(null)
      })

    consumer = createStreamConsumer({
      redis: redis as any,
      group: 'test-group',
      consumer: 'test-consumer',
      streams: { 'events.test': { 'role.updated': specificHandler } },
      logger: mockLogger,
      pollIntervalMs: 0,
    })

    await consumer.start()

    expect(specificHandler).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 'r2' }),
      'role.updated',
    )
  })

  it('ACKs message and logs warning when neither specific nor catch-all handler exists', async () => {
    const redis = makeMockRedis()
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([['events.test', [makeMessage('1-0', 'unknown.event', {})]]])
      .mockImplementationOnce(() => {
        consumer.stop()
        return Promise.resolve(null)
      })

    consumer = createStreamConsumer({
      redis: redis as any,
      group: 'test-group',
      consumer: 'test-consumer',
      streams: { 'events.test': {} },
      logger: mockLogger,
      pollIntervalMs: 0,
    })

    await consumer.start()

    expect(redis.xack).toHaveBeenCalledWith('events.test', 'test-group', '1-0')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it("'*' only called for types without a specific handler when registered alongside multiple specific handlers", async () => {
    const redis = makeMockRedis()
    const handlerA = vi.fn().mockResolvedValue(undefined)
    const handlerB = vi.fn().mockResolvedValue(undefined)
    const catchAll = vi.fn().mockResolvedValue(undefined)
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([
        [
          'events.test',
          [
            makeMessage('1-0', 'type.a', { a: 1 }),
            makeMessage('1-1', 'type.b', { b: 1 }),
            makeMessage('1-2', 'type.c', { c: 1 }),
          ],
        ],
      ])
      .mockImplementationOnce(() => {
        consumer.stop()
        return Promise.resolve(null)
      })

    consumer = createStreamConsumer({
      redis: redis as any,
      group: 'test-group',
      consumer: 'test-consumer',
      streams: {
        'events.test': { 'type.a': handlerA, 'type.b': handlerB, '*': catchAll },
      },
      logger: mockLogger,
      pollIntervalMs: 0,
    })

    await consumer.start()

    expect(handlerA).toHaveBeenCalledOnce()
    expect(handlerB).toHaveBeenCalledOnce()
    expect(catchAll).toHaveBeenCalledOnce()
    expect(catchAll).toHaveBeenCalledWith(expect.objectContaining({ c: 1 }), 'type.c')
  })

  it("'*' handler catches multiple different event types from the same stream", async () => {
    const redis = makeMockRedis()
    const receivedTypes: string[] = []
    const catchAll = vi.fn().mockImplementation(async (_data: unknown, type: string) => {
      receivedTypes.push(type)
    })
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([
        [
          'events.test',
          [
            makeMessage('1-0', 'job_order.started', { jobOrderId: 'jo1' }),
            makeMessage('1-1', 'scrap_entry.created', { scrapEntryId: 's1' }),
          ],
        ],
      ])
      .mockImplementationOnce(() => {
        consumer.stop()
        return Promise.resolve(null)
      })

    consumer = createStreamConsumer({
      redis: redis as any,
      group: 'test-group',
      consumer: 'test-consumer',
      streams: { 'events.test': { '*': catchAll } },
      logger: mockLogger,
      pollIntervalMs: 0,
    })

    await consumer.start()

    expect(receivedTypes).toEqual(['job_order.started', 'scrap_entry.created'])
  })
})
