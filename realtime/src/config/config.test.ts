import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

describe('RealtimeConfig.validation', () => {
  const originalEnv = process.env

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

    const { config } = await import('./index.js')

    expect(config.NODE_ENV).toBe('development')
    expect(config.PORT).toBe(3003)
    expect(config.REDIS_URL).toBe('redis://localhost:6379')
    expect(config.LOG_LEVEL).toBe('info')
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
})
