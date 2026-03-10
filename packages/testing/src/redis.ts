import { vi } from 'vitest'

export function createRedisMock() {
  const store = new Map<string, string>()

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
      store.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0
      for (const key of keys) {
        if (store.delete(key)) count++
      }
      return count
    }),
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),
    disconnect: vi.fn(),
    scanStream: vi.fn(() => {
      const { Readable } = require('stream') as typeof import('stream')
      const stream = new Readable({
        objectMode: true,
        read() {
          this.push(null)
        },
      })
      return stream
    }),
    status: 'ready' as const,

    /** Clear the in-memory store between tests */
    _clear: () => store.clear(),
    /** Inspect current store contents */
    _store: store,
  }
}

export type RedisMock = ReturnType<typeof createRedisMock>
