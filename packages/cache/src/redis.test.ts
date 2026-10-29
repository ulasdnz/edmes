import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'winston'
import { createRedisClient } from './redis.js'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger

// Nothing listens on port 1, so the client can never connect.
const UNREACHABLE_URL = 'redis://127.0.0.1:1'

describe('createRedisClient', () => {
  const clients: ReturnType<typeof createRedisClient>[] = []

  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect()
  })

  // Queued commands would hold requests open until Redis came back; callers expect a fast error
  // so the cache can fall back to the database.
  it('fails commands immediately while Redis is unreachable instead of queueing them', async () => {
    const client = createRedisClient(UNREACHABLE_URL, { name: 'cache', keyPrefix: 'svc:', logger })
    clients.push(client)

    const startedAt = Date.now()
    await expect(client.get('key')).rejects.toThrow(/enableOfflineQueue/)
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('prefixes keys only when a prefix is given', () => {
    const prefixed = createRedisClient(UNREACHABLE_URL, {
      name: 'cache',
      keyPrefix: 'svc:',
      logger,
    })
    const shared = createRedisClient(UNREACHABLE_URL, { name: 'shared', logger })
    clients.push(prefixed, shared)

    expect(prefixed.options.keyPrefix).toBe('svc:')
    expect(shared.options.keyPrefix).toBe('')
  })
})
