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
    xadd: vi.fn().mockResolvedValue('1-1'),
    xautoclaim: vi.fn().mockResolvedValue(['0-0', []]),
    xpending: vi.fn().mockResolvedValue([]),
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

  it('reclaims abandoned pending messages before reading new ones', async () => {
    const redis = makeMockRedis()
    const catchAll = vi.fn().mockResolvedValue(undefined)
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xautoclaim
      .mockResolvedValueOnce(['1-0', [makeMessage('1-0', 'foo.bar', { reclaimed: true })]])
      .mockResolvedValueOnce(['0-0', []])

    redis.xreadgroup.mockResolvedValueOnce(null).mockImplementationOnce(() => {
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
      reclaimMinIdleMs: 15000,
      reclaimBatchSize: 25,
    })

    await consumer.start()

    expect(redis.xautoclaim).toHaveBeenCalledWith(
      'events.test',
      'test-group',
      'test-consumer',
      15000,
      '0-0',
      'COUNT',
      25,
    )
    expect(catchAll).toHaveBeenCalledWith(expect.objectContaining({ reclaimed: true }), 'foo.bar')
    expect(redis.xack).toHaveBeenCalledWith('events.test', 'test-group', '1-0')
  })

  it('stops reclaim loop when no abandoned pending messages remain', async () => {
    const redis = makeMockRedis()
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup.mockResolvedValueOnce(null).mockImplementationOnce(() => {
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

    expect(redis.xautoclaim).toHaveBeenCalledTimes(1)
    expect(redis.xautoclaim).toHaveBeenCalledWith(
      'events.test',
      'test-group',
      'test-consumer',
      30000,
      '0-0',
      'COUNT',
      50,
    )
  })

  it('dead-letters poison messages after max deliveries and ACKs the source message', async () => {
    const redis = makeMockRedis()
    const catchAll = vi.fn().mockRejectedValue(new Error('boom'))
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xpending.mockResolvedValueOnce([['1-0', 'other-consumer', 1000, 5]])
    redis.xreadgroup
      .mockResolvedValueOnce(null)
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
      maxDeliveries: 5,
    })

    await consumer.start()

    expect(redis.xadd).toHaveBeenCalledOnce()
    expect(redis.xadd.mock.calls[0][0]).toBe('events.test.dlq')
    expect(redis.xadd.mock.calls[0][6]).toBe('foo.bar')
    expect(JSON.parse(redis.xadd.mock.calls[0][8])).toEqual(
      expect.objectContaining({
        originalStream: 'events.test',
        originalId: '1-0',
        data: { x: 1 },
        error: 'boom',
        deliveries: 5,
        consumer: 'test-consumer',
      }),
    )
    expect(redis.xack).toHaveBeenCalledWith('events.test', 'test-group', '1-0')
  })

  it('keeps failed messages pending while deliveries are below the dead-letter threshold', async () => {
    const redis = makeMockRedis()
    const catchAll = vi.fn().mockRejectedValue(new Error('boom'))
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xpending.mockResolvedValueOnce([['1-0', 'other-consumer', 1000, 2]])
    redis.xreadgroup
      .mockResolvedValueOnce(null)
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
      maxDeliveries: 5,
    })

    await consumer.start()

    expect(redis.xadd).not.toHaveBeenCalled()
    expect(redis.xack).not.toHaveBeenCalled()
  })

  it('uses non-blocking reads for new messages by default', async () => {
    const redis = makeMockRedis()
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup.mockResolvedValueOnce(null).mockImplementationOnce(() => {
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

    expect(redis.xreadgroup).toHaveBeenNthCalledWith(
      2,
      'GROUP',
      'test-group',
      'test-consumer',
      'COUNT',
      '10',
      'STREAMS',
      'events.test',
      '>',
    )
  })

  it('uses bounded blocking reads when readBlockMs is configured', async () => {
    const redis = makeMockRedis()
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup.mockResolvedValueOnce(null).mockImplementationOnce(() => {
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
      readBlockMs: 5000,
    })

    await consumer.start()

    expect(redis.xreadgroup).toHaveBeenNthCalledWith(
      2,
      'GROUP',
      'test-group',
      'test-consumer',
      'COUNT',
      '10',
      'BLOCK',
      '5000',
      'STREAMS',
      'events.test',
      '>',
    )
  })

  it('waits for the in-flight handler to finish before stop resolves', async () => {
    const redis = makeMockRedis()
    let releaseHandler!: () => void
    const handlerFinished = new Promise<void>(resolve => {
      releaseHandler = resolve
    })
    const catchAll = vi.fn().mockImplementation(async () => handlerFinished)
    let consumer: ReturnType<typeof createStreamConsumer>

    redis.xreadgroup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([['events.test', [makeMessage('1-0', 'foo.bar', { x: 1 })]]])
      .mockImplementation(() => Promise.resolve(null))

    consumer = createStreamConsumer({
      redis: redis as any,
      group: 'test-group',
      consumer: 'test-consumer',
      streams: { 'events.test': { '*': catchAll } },
      logger: mockLogger,
      pollIntervalMs: 0,
      readBlockMs: 0,
    })

    const startPromise = consumer.start()
    // Flush enough microtasks for the consumer to reach the handler
    // (ensureGroups → recoverAbandonedPending → processPending → pollLoop → processBatch → handler)
    while (catchAll.mock.calls.length === 0) await Promise.resolve()

    const stopPromise = consumer.stop()
    let stopResolved = false
    void stopPromise.then(() => {
      stopResolved = true
    })

    await Promise.resolve()
    expect(stopResolved).toBe(false)

    releaseHandler()

    await stopPromise
    await startPromise

    expect(redis.xack).toHaveBeenCalledWith('events.test', 'test-group', '1-0')
  })
})
