import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import type { Express, NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SYSTEM_IDENTITY } from '../../../constants/identity.js'
import { initLoaders } from '../index.js'

vi.mock('../mongoose.js', () => ({
  initMongoose: vi.fn(),
}))

vi.mock('../../../database/migrations/index.js', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('../../../jobs/subscribers.js', () => ({
  initSubscribers: vi.fn(),
  shutdownSubscribers: vi.fn(),
}))

vi.mock('../../../lib/redis.js', () => ({
  initRedis: vi.fn(),
  closeRedis: vi.fn(),
  redisClient: {
    connect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
  },
  sharedClient: {
    connect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
  },
  streamClient: {
    connect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    xadd: vi.fn().mockResolvedValue('1-0'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xgroup: vi.fn(),
    xack: vi.fn(),
    quit: vi.fn(),
  },
}))

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  morganMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}))

const AUTH_CONTEXT_PATH = `/internal/v1/users/${SYSTEM_IDENTITY}/auth-context`

let app: Express

describe('Internal routes', () => {
  beforeAll(async () => {
    app = await initLoaders()
  })

  it('rejects calls without the internal token', async () => {
    const res = await request(app).get(AUTH_CONTEXT_PATH)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('auth.unauthenticated')
  })

  it('rejects calls with a wrong internal token', async () => {
    const res = await request(app)
      .get(AUTH_CONTEXT_PATH)
      .set(INTERNAL_TOKEN_HEADER, 'not-the-internal-token-but-long-enough')

    expect(res.status).toBe(401)
  })

  it('serves calls that carry the internal token with system permissions', async () => {
    const res = await request(app)
      .get(AUTH_CONTEXT_PATH)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)

    expect(res.status).toBe(200)
    expect(res.body.data.permissions).toEqual(['*'])
  })
})
