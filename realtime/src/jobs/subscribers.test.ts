import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { EventHandler } from '@mes/events'

const mockEmit = vi.fn()
const mockTo = vi.fn(() => ({ to: mockTo, emit: mockEmit }))
const mockIO = { to: mockTo, emit: mockEmit }

vi.mock('../gateway/socket.js', () => ({
  getIO: () => mockIO,
  initSocketServer: vi.fn(),
}))

vi.mock('../gateway/router.js', () => ({
  resolveRooms: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({ streamClient: {} }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@mes/core', () => ({
  runInContext: vi.fn((_ctx: unknown, fn: () => Promise<void>) => fn()),
}))

let capturedConfig: {
  group: string
  streams: Record<string, Record<string, EventHandler>>
}

vi.mock('@mes/events', () => ({
  createStreamConsumer: vi.fn((config: any) => {
    capturedConfig = config
    return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
  }),
}))

import { resolveRooms } from '../gateway/router.js'

describe('Subscribers.catchAllForwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTo.mockReturnValue({ to: mockTo, emit: mockEmit })
  })

  // Force module re-evaluation isn't needed — capturedConfig is set at import time
  // We access the subscribers module to trigger its side effects
  beforeAll(async () => {
    await import('./subscribers.js')
  })

  // ── happy path ────────────────────────────────────────────────────────

  it('calls resolveRooms and emits to resolved rooms with event type as Socket.io event name', async () => {
    vi.mocked(resolveRooms).mockReturnValue(['job_order', 'wc:abc'])
    const handler = capturedConfig.streams['events.production']['*']
    const payload = { workCenterId: 'abc', jobOrderId: 'jo1' }

    await handler(payload, 'job_order.started')

    expect(resolveRooms).toHaveBeenCalledWith('job_order.started', payload)
    expect(mockEmit).toHaveBeenCalled()
  })

  it("emits io.to('job_order').to('wc:abc').emit('job_order.started', payload)", async () => {
    vi.mocked(resolveRooms).mockReturnValue(['job_order', 'wc:abc'])
    const handler = capturedConfig.streams['events.production']['*']
    const payload = { workCenterId: 'abc' }

    await handler(payload, 'job_order.started')

    expect(mockTo).toHaveBeenCalledWith(['job_order', 'wc:abc'])
    expect(mockEmit).toHaveBeenCalledWith('job_order.started', payload)
  })

  // ── constraints ───────────────────────────────────────────────────────

  it("uses 'realtime' as consumer group name", () => {
    expect(capturedConfig.group).toBe('realtime')
  })

  it('subscribes to all three streams', () => {
    const streams = Object.keys(capturedConfig.streams)
    expect(streams).toContain('events.user')
    expect(streams).toContain('events.work_center')
    expect(streams).toContain('events.production')
  })

  it("uses '*' handler for all streams", () => {
    for (const stream of ['events.user', 'events.work_center', 'events.production']) {
      const handlers = capturedConfig.streams[stream]
      expect(handlers['*']).toBeDefined()
      expect(Object.keys(handlers)).toEqual(['*'])
    }
  })

  // ── edge cases ────────────────────────────────────────────────────────

  it('emits to room with no connected clients without error', async () => {
    vi.mocked(resolveRooms).mockReturnValue(['empty_room'])
    const handler = capturedConfig.streams['events.user']['*']

    await expect(handler({ userId: 'u1' }, 'user.updated')).resolves.not.toThrow()
  })
})
