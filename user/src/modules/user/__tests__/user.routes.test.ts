import { PRIVILEGES, VALID_PRIVILEGE_CODES } from '@mes/privileges'
import type { Express, NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../../../config/index.js'
import { initLoaders } from '../../../core/loaders/index.js'
import Role from '../../role/role.model.js'
import User from '../user.model.js'

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

describe('User Routes Integration', () => {
  beforeAll(async () => {
    app = await initLoaders()
  })

  it('POST /api/v1/auth/register should create a new user', async () => {
    const userData = {
      username: 'integrationuser',
      email: 'integration@example.com',
      password: 'Password123!',
      name: 'Integration',
      surname: 'Test',
    }

    const res = await request(app).post('/api/v1/auth/register').send(userData)

    expect(res.status).toBe(201)
    expect(res.body.data.email).toBe(userData.email)

    const user = await User.findOne({ email: userData.email })
    expect(user).toBeDefined()
    expect(user?.name).toBe(userData.name)
  })

  it('POST /api/v1/auth/register should fail with duplicate email', async () => {
    const userData = {
      username: 'duplicateuser',
      email: 'duplicate@example.com',
      password: 'Password123!',
      name: 'Duplicate',
      surname: 'User',
    }

    await request(app).post('/api/v1/auth/register').send(userData)

    const res = await request(app).post('/api/v1/auth/register').send(userData)

    expect(res.status).toBe(409)
    expect(res.body.error).toBeDefined()
  })

  it('POST /api/v1/auth/login should return token for valid credentials', async () => {
    const userData = {
      username: 'loginuser',
      email: 'login@example.com',
      password: 'Password123!',
      name: 'Login',
      surname: 'User',
    }

    await request(app).post('/api/v1/auth/register').send(userData)

    const res = await request(app).post('/api/v1/auth/login').send({
      email: userData.email,
      password: userData.password,
    })

    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeDefined()
  })

  it('POST /api/v1/auth/login should fail for invalid credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'nonexistent@example.com',
      password: 'wrongpassword',
    })

    expect(res.status).toBe(401)
  })

  describe('GET /api/v1/users/me permissions', () => {
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

    async function createUserToken(suffix: string, roleIds: Types.ObjectId[]) {
      const user = await User.create({
        username: `meuser${suffix}`,
        email: `me${suffix}@example.com`,
        password: 'Password123!',
        name: 'Me',
        surname: 'User',
        roles: roleIds,
      })
      return jwt.sign({ id: user._id.toString() }, config.JWT_SECRET)
    }

    it('returns the resolved permissions of the caller in meta', async () => {
      routeAuthContextToApp()
      const roleA = await Role.create({ name: 'me-role-a', permissions: ['readUsers'] })
      const roleB = await Role.create({
        name: 'me-role-b',
        permissions: ['readUsers', 'accessWebApp'],
      })
      const token = await createUserToken('perm', [roleA._id, roleB._id])

      const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect([...res.body.meta.permissions].sort()).toEqual(['accessWebApp', 'readUsers'])
      expect(res.body.meta.plantTimezone).toBe(config.PLANT_TIMEZONE)
    })

    it('returns an empty permission list for a user with no roles', async () => {
      routeAuthContextToApp()
      const token = await createUserToken('norole', [])

      const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.meta.permissions).toEqual([])
    })
  })

  it('has the two application privileges and no screen privileges', () => {
    expect(VALID_PRIVILEGE_CODES.has('accessWebApp')).toBe(true)
    expect(VALID_PRIVILEGE_CODES.has('accessOperatorPanel')).toBe(true)
    expect(PRIVILEGES.filter(p => p.code.endsWith('Screen'))).toEqual([])
  })
})
