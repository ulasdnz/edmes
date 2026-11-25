import type { Express, NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../../../config/index.js'
import { ensureDefaultRoles } from '../../../core/loaders/default-roles.js'
import { initLoaders } from '../../../core/loaders/index.js'
import User from '../../user/user.model.js'
import Role from '../role.model.js'

vi.mock('../../../core/loaders/mongoose', () => ({
  initMongoose: vi.fn(),
}))

vi.mock('../../../database/migrations/index', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('../../../jobs/subscribers', () => ({
  initSubscribers: vi.fn(),
  shutdownSubscribers: vi.fn(),
}))

vi.mock('../../../lib/redis', () => ({
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

vi.mock('../../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  morganMiddleware: (req: Request, res: Response, next: NextFunction) => next(),
}))

let app: Express

describe('Role Routes Integration', () => {
  beforeAll(async () => {
    app = await initLoaders()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The auth middleware resolves permissions over HTTP from user-service itself. Route that
  // call back into the same app so the real auth-context endpoint and MongoDB are exercised.
  function routeAuthContextToApp() {
    const realFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.startsWith(config.INTERNAL_API_USER)) return realFetch(input, init)
      const res = await request(app)
        .get(url.slice(config.INTERNAL_API_USER.length))
        .set(init?.headers as Record<string, string>)
      return new Response(JSON.stringify(res.body), { status: res.status })
    })
  }

  async function createReaderToken() {
    const role = await Role.create({ name: 'role-reader', permissions: ['readRoles'] })
    const user = await User.create({
      username: 'rolereader',
      email: 'rolereader@example.com',
      password: 'Password123!',
      name: 'Role',
      surname: 'Reader',
      roles: [role._id],
    })
    return jwt.sign({ id: user._id.toString() }, config.JWT_SECRET)
  }

  it('returns the key of a ready-made role in the list and in the detail', async () => {
    routeAuthContextToApp()
    await ensureDefaultRoles({ firstInstall: true })
    const token = await createReaderToken()
    const planner = await Role.findOne({ key: 'planner' }).lean()

    const list = await request(app).get('/api/v1/roles').set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(200)
    const item = list.body.data.find((role: { _id: string }) => role._id === String(planner?._id))
    expect(item.key).toBe('planner')

    const detail = await request(app)
      .get(`/api/v1/roles/${planner?._id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.key).toBe('planner')
  })
})
