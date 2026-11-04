import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

describe('RealtimeConfig.validation', () => {
  const originalEnv = process.env

  // The first import compiles the config module and loads its dependencies. Paid here, that
  // one-time cost, which a busy machine stretches past a test's time limit, stays out of the tests.
  beforeAll(async () => {
    process.env = { ...originalEnv, REDIS_URL: 'redis://localhost:6379' }
    await import('./index.js')
  })

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  // ── happy path ────────────────────────────────────────────────────────

  it('parses valid env into config object with correct types and values', async () => {
    process.env.NODE_ENV = 'development'
    process.env.PORT = '3003'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.LOG_LEVEL = 'info'
    process.env.STREAM_CONSUMER_BATCH_SIZE = '20'
    process.env.STREAM_CONSUMER_BLOCK_MS = '4000'
    process.env.STREAM_CONSUMER_RECLAIM_MIN_IDLE_MS = '45000'
    process.env.STREAM_CONSUMER_RECLAIM_BATCH_SIZE = '60'
    process.env.STREAM_CONSUMER_MAX_DELIVERIES = '7'

    const { config } = await import('./index.js')

    expect(config.NODE_ENV).toBe('development')
    expect(config.PORT).toBe(3003)
    expect(config.REDIS_URL).toBe('redis://localhost:6379')
    expect(config.LOG_LEVEL).toBe('info')
    expect(config.STREAM_CONSUMER_BATCH_SIZE).toBe(20)
    expect(config.STREAM_CONSUMER_BLOCK_MS).toBe(4000)
    expect(config.STREAM_CONSUMER_RECLAIM_MIN_IDLE_MS).toBe(45000)
    expect(config.STREAM_CONSUMER_RECLAIM_BATCH_SIZE).toBe(60)
    expect(config.STREAM_CONSUMER_MAX_DELIVERIES).toBe(7)
  })

  // ── constraints ───────────────────────────────────────────────────────

  it('exits when REDIS_URL is not a valid redis:// or rediss:// URL', async () => {
    process.env.REDIS_URL = 'not-a-valid-url'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('exits when REDIS_URL is empty string', async () => {
    process.env.REDIS_URL = ''
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('defaults PORT to 3003 if not provided', async () => {
    delete process.env.PORT
    process.env.REDIS_URL = 'redis://localhost:6379'

    const { config } = await import('./index.js')

    expect(config.PORT).toBe(3003)
  })

  it("defaults NODE_ENV to 'development' if not provided", async () => {
    delete process.env.NODE_ENV
    process.env.REDIS_URL = 'redis://localhost:6379'

    const { config } = await import('./index.js')

    expect(config.NODE_ENV).toBe('development')
  })

  it("defaults LOG_LEVEL to 'info' if not provided", async () => {
    delete process.env.LOG_LEVEL
    process.env.REDIS_URL = 'redis://localhost:6379'

    const { config } = await import('./index.js')

    expect(config.LOG_LEVEL).toBe('info')
  })

  it('defaults stream consumer tuning when not provided', async () => {
    delete process.env.STREAM_CONSUMER_BATCH_SIZE
    delete process.env.STREAM_CONSUMER_BLOCK_MS
    delete process.env.STREAM_CONSUMER_RECLAIM_MIN_IDLE_MS
    delete process.env.STREAM_CONSUMER_RECLAIM_BATCH_SIZE
    delete process.env.STREAM_CONSUMER_MAX_DELIVERIES
    process.env.REDIS_URL = 'redis://localhost:6379'

    const { config } = await import('./index.js')

    expect(config.STREAM_CONSUMER_BATCH_SIZE).toBe(10)
    expect(config.STREAM_CONSUMER_BLOCK_MS).toBe(5000)
    expect(config.STREAM_CONSUMER_RECLAIM_MIN_IDLE_MS).toBe(30000)
    expect(config.STREAM_CONSUMER_RECLAIM_BATCH_SIZE).toBe(50)
    expect(config.STREAM_CONSUMER_MAX_DELIVERIES).toBe(5)
  })

  // ── boundaries ────────────────────────────────────────────────────────

  it('accepts rediss:// (TLS) URL as valid', async () => {
    process.env.REDIS_URL = 'rediss://secure-host:6380'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    const { config } = await import('./index.js')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(config.REDIS_URL).toBe('rediss://secure-host:6380')
    exitSpy.mockRestore()
  })

  it('exits when REDIS_URL uses http:// protocol', async () => {
    process.env.REDIS_URL = 'http://localhost:6379'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('exits when REDIS_URL is redis:// with no host', async () => {
    process.env.REDIS_URL = 'redis://'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('exits when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET
    process.env.REDIS_URL = 'redis://localhost:6379'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('exits when STREAM_CONSUMER_BLOCK_MS is negative', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.STREAM_CONSUMER_BLOCK_MS = '-1'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
