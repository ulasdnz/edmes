import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./core/loaders/mongoose.js', () => ({
  initMongoose: vi.fn(async () => {}),
}))

vi.mock('./lib/redis.js', () => {
  const fakeClient = {
    ping: vi.fn(async () => 'PONG'),
    on: vi.fn(),
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => 'OK'),
  }
  return {
    redisClient: fakeClient,
    sharedClient: fakeClient,
    streamClient: fakeClient,
    initRedis: vi.fn(async () => {}),
    closeRedis: vi.fn(async () => {}),
  }
})

vi.mock('./jobs/subscribers.js', () => ({
  initSubscribers: vi.fn(async () => {}),
}))

vi.mock('./modules/planned-stop-schedule/planned-stop-schedule.scheduler.js', () => ({
  startPlannedStopScheduler: vi.fn(async () => {}),
  stopPlannedStopScheduler: vi.fn(() => {}),
}))

vi.mock('./modules/run-mode/run-mode.debounce-tick.js', () => ({
  startDebounceTick: vi.fn(() => {}),
  stopDebounceTick: vi.fn(() => {}),
}))

vi.mock('./modules/run-mode/run-mode.reconciler.js', () => ({
  reconcileOnBoot: vi.fn(async () => {}),
}))

describe('app smoke', () => {
  it('GET /health/live returns 200 after initExpress', async () => {
    const { initExpress } = await import('./core/loaders/express.js')
    const app = await initExpress()
    const res = await request(app).get('/health/live')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ alive: true })
  })

  it('GET /health/ready returns 200 after initLoaders', async () => {
    const { initLoaders } = await import('./core/loaders/index.js')
    const app = await initLoaders()
    expect(app).toBeDefined()
    const res = await request(app!).get('/health/ready')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ready: true })
  })
})
