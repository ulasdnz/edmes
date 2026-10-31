import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

describe('TelemetryConfig.validation', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  const validEnv = () => {
    process.env.NODE_ENV = 'development'
    process.env.PORT = '3004'
    process.env.MONGO_URI = 'mongodb://localhost:27017/telemetry'
    process.env.JWT_SECRET = 'test_secret'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.INTERNAL_API_USER = 'http://localhost:3000'
    process.env.MQTT_URL = 'mqtt://localhost:1883'
    process.env.MQTT_USERNAME = 'mes'
    process.env.MQTT_PASSWORD = 'secret'
  }

  // The first import compiles the config module and loads its dependencies. Paid here, that
  // one-time cost, which a busy machine stretches past a test's time limit, stays out of the tests.
  beforeAll(async () => {
    process.env = { ...originalEnv }
    validEnv()
    await import('./index.js')
  })

  // ── happy path ────────────────────────────────────────────────────────

  it('parses valid env into config object with correct types and values', async () => {
    validEnv()

    const { config } = await import('./index.js')

    expect(config.NODE_ENV).toBe('development')
    expect(config.PORT).toBe(3004)
    expect(config.MONGO_URI).toBe('mongodb://localhost:27017/telemetry')
    expect(config.REDIS_URL).toBe('redis://localhost:6379')
    expect(config.MQTT_URL).toBe('mqtt://localhost:1883')
    expect(config.MQTT_USERNAME).toBe('mes')
  })

  // ── defaults ──────────────────────────────────────────────────────────

  it('defaults PORT to 3001 if not provided', async () => {
    validEnv()
    delete process.env.PORT

    const { config } = await import('./index.js')

    expect(config.PORT).toBe(3001)
  })

  it("defaults NODE_ENV to 'development' if not provided", async () => {
    validEnv()
    delete process.env.NODE_ENV

    const { config } = await import('./index.js')

    expect(config.NODE_ENV).toBe('development')
  })

  it("defaults LOG_LEVEL to 'info' if not provided", async () => {
    validEnv()
    delete process.env.LOG_LEVEL

    const { config } = await import('./index.js')

    expect(config.LOG_LEVEL).toBe('info')
  })

  it("defaults MONGO_INDEX_STRATEGY to 'off' in non-production", async () => {
    validEnv()

    const { config } = await import('./index.js')

    expect(config.MONGO_INDEX_STRATEGY).toBe('off')
  })

  // ── constraints ───────────────────────────────────────────────────────

  it('exits when MONGO_URI is missing', async () => {
    validEnv()
    delete process.env.MONGO_URI
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('exits when REDIS_URL uses http:// protocol', async () => {
    validEnv()
    process.env.REDIS_URL = 'http://localhost:6379'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('exits when MQTT_URL is missing', async () => {
    validEnv()
    delete process.env.MQTT_URL
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('exits when MQTT_URL uses invalid protocol', async () => {
    validEnv()
    process.env.MQTT_URL = 'http://localhost:1883'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./index.js')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
