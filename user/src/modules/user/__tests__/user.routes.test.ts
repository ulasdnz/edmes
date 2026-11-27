import { APPLICATION_PRIVILEGES, PRIVILEGES, VALID_PRIVILEGE_CODES } from '@mes/privileges'
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

    // scenario: UsersMe.permissions / happy path / one role with two permissions
    it('returns the permissions of a single role sorted in meta', async () => {
      routeAuthContextToApp()
      const role = await Role.create({
        name: 'me-role-single',
        permissions: ['readUsers', 'accessWebApp'],
      })
      const token = await createUserToken('single', [role._id])

      const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect([...res.body.meta.permissions].sort()).toEqual(['accessWebApp', 'readUsers'])
    })

    // scenario: UsersMe.permissions / happy path / plantTimezone and serverTime beside permissions
    it('returns plantTimezone and serverTime beside permissions', async () => {
      routeAuthContextToApp()
      const role = await Role.create({ name: 'me-role-meta', permissions: ['readUsers'] })
      const token = await createUserToken('meta', [role._id])

      const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.meta.plantTimezone).toBe(config.PLANT_TIMEZONE)
      expect(res.body.meta.serverTime).toEqual(expect.any(String))
      expect(res.body.meta.permissions).toEqual(['readUsers'])
    })

    // scenario: UsersMe.permissions / authorization / each caller gets own permissions
    it('gives each caller the permissions of their own token', async () => {
      routeAuthContextToApp()
      const roleA = await Role.create({ name: 'me-role-iso-a', permissions: ['readUsers'] })
      const roleB = await Role.create({
        name: 'me-role-iso-b',
        permissions: ['accessOperatorPanel'],
      })
      const tokenA = await createUserToken('isoa', [roleA._id])
      const tokenB = await createUserToken('isob', [roleB._id])

      const resA = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenA}`)
      const resB = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenB}`)

      expect(resA.status).toBe(200)
      expect(resB.status).toBe(200)
      expect(resA.body.meta.permissions).toEqual(['readUsers'])
      expect(resB.body.meta.permissions).toEqual(['accessOperatorPanel'])
    })

    it('returns an empty permission list for a user with no roles', async () => {
      routeAuthContextToApp()
      const token = await createUserToken('norole', [])

      const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.meta.permissions).toEqual([])
    })

    it('POST /api/v1/auth/login and GET /users/me never return the lockout counters', async () => {
      routeAuthContextToApp()
      const userData = {
        username: 'lockoutuser',
        email: 'lockout@example.com',
        password: 'Password123!',
        name: 'Lockout',
        surname: 'User',
      }
      await request(app).post('/api/v1/auth/register').send(userData)
      // A failed attempt first, so the counters hold values worth hiding
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: userData.email, password: 'Wrong-password-1' })

      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: userData.email, password: userData.password })

      expect(login.status).toBe(200)
      expect(login.body.data.user).not.toHaveProperty('password')
      expect(login.body.data.user).not.toHaveProperty('failedLoginAttempts')
      expect(login.body.data.user).not.toHaveProperty('lastFailedLoginAt')

      const me = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${login.body.data.token}`)
      expect(me.status).toBe(200)
      expect(me.body.data).not.toHaveProperty('failedLoginAttempts')
      expect(me.body.data).not.toHaveProperty('lastFailedLoginAt')
    })
  })

  describe('GET /api/v1/auth/plant-time', () => {
    // scenario: AuthPlantTime.public / happy path / no Authorization header
    it('answers the plant timezone and the server time without a token', async () => {
      const res = await request(app).get('/api/v1/auth/plant-time')

      expect(res.status).toBe(200)
      expect(res.body.data.plantTimezone).toBe(config.PLANT_TIMEZONE)
      expect(res.body.data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(Math.abs(Date.parse(res.body.data.serverTime) - Date.now())).toBeLessThan(5000)
    })

    // scenario: AuthPlantTime.public / constraints / [CRITICAL] exactly plantTimezone and serverTime
    it('answers exactly plantTimezone and serverTime under data and nothing else', async () => {
      const res = await request(app).get('/api/v1/auth/plant-time')

      expect(res.status).toBe(200)
      expect(Object.keys(res.body)).toEqual(['data'])
      expect(Object.keys(res.body.data).sort()).toEqual(['plantTimezone', 'serverTime'])
    })

    // scenario: AuthPlantTime.public / constraints / invalid or expired Bearer token still 200
    it('ignores an invalid or expired Bearer token', async () => {
      const expired = jwt.sign(
        { id: '507f1f77bcf86cd799439011', exp: Math.floor(Date.now() / 1000) - 60 },
        config.JWT_SECRET,
      )

      const invalid = await request(app)
        .get('/api/v1/auth/plant-time')
        .set('Authorization', 'Bearer not-a-token')
      const old = await request(app)
        .get('/api/v1/auth/plant-time')
        .set('Authorization', `Bearer ${expired}`)

      expect(invalid.status).toBe(200)
      expect(invalid.body.data.plantTimezone).toBe(config.PLANT_TIMEZONE)
      expect(old.status).toBe(200)
      expect(old.body.data.plantTimezone).toBe(config.PLANT_TIMEZONE)
    })
  })

  describe('GET /api/v1/users?withoutWorkCenter', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

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

    const workCenterId = '64b000000000000000000001'

    // The caller has a work center, so it never counts among the users without one
    async function createCaller(permissions: string[]) {
      const role = await Role.create({ name: `wc-filter-${permissions.length}`, permissions })
      const caller = await User.create({
        username: 'wcfiltercaller',
        email: 'wcfiltercaller@example.com',
        password: 'Password123!',
        name: 'Caller',
        surname: 'User',
        roles: [role._id],
        workCenterIds: [workCenterId],
      })
      return jwt.sign({ id: caller._id.toString() }, config.JWT_SECRET)
    }

    async function createUser(suffix: string, fields: Record<string, unknown>) {
      return User.create({
        username: `wcfilter${suffix}`,
        email: `wcfilter${suffix}@example.com`,
        password: 'Password123!',
        name: 'Filter',
        surname: suffix,
        ...fields,
      })
    }

    async function seedThree() {
      await createUser('none1', { workCenterIds: [] })
      await createUser('none2', { workCenterIds: [] })
      await createUser('one', { workCenterIds: [workCenterId] })
    }

    const list = (token: string, query: string) =>
      request(app).get(`/api/v1/users?${query}`).set('Authorization', `Bearer ${token}`)

    // scenario: UsersList.withoutWorkCenter / happy path / only the two without a work center
    it('withoutWorkCenter=true answers only the users with no work center', async () => {
      routeAuthContextToApp()
      const token = await createCaller(['readUsers'])
      await seedThree()

      const res = await list(token, 'withoutWorkCenter=true')

      expect(res.status).toBe(200)
      expect(res.body.data.map((u: { username: string }) => u.username).sort()).toEqual([
        'wcfilternone1',
        'wcfilternone2',
      ])
      expect(res.body.pagination.total).toBe(2)
    })

    // scenario: UsersList.withoutWorkCenter / happy path / empty (or missing) workCenterIds
    it('withoutWorkCenter=true also counts a user whose workCenterIds field is missing', async () => {
      routeAuthContextToApp()
      const token = await createCaller(['readUsers'])
      const user = await createUser('missing', {})
      await User.collection.updateOne({ _id: user._id }, { $unset: { workCenterIds: '' } })

      const res = await list(token, 'withoutWorkCenter=true')

      expect(res.status).toBe(200)
      expect(res.body.data.map((u: { username: string }) => u.username)).toEqual([
        'wcfiltermissing',
      ])
      expect(res.body.pagination.total).toBe(1)
    })

    // scenario: UsersList.withoutWorkCenter / boundaries / false or absent → no filter
    it('withoutWorkCenter=false or absent applies no filter', async () => {
      routeAuthContextToApp()
      const token = await createCaller(['readUsers'])
      await seedThree()

      const off = await list(token, 'withoutWorkCenter=false')
      const absent = await list(token, '')

      // The three seeded users and the caller
      expect(off.status).toBe(200)
      expect(off.body.pagination.total).toBe(4)
      expect(absent.status).toBe(200)
      expect(absent.body.pagination.total).toBe(4)
    })

    // scenario: UsersList.withoutWorkCenter / boundaries / combines with isActivated
    it('withoutWorkCenter=true&isActivated=true answers only the active user without one', async () => {
      routeAuthContextToApp()
      const token = await createCaller(['readUsers'])
      await createUser('none1', { workCenterIds: [] })
      await createUser('none2', { workCenterIds: [], isActivated: false })
      await createUser('one', { workCenterIds: [workCenterId] })

      const res = await list(token, 'withoutWorkCenter=true&isActivated=true')

      expect(res.status).toBe(200)
      expect(res.body.data.map((u: { username: string }) => u.username)).toEqual(['wcfilternone1'])
      expect(res.body.pagination.total).toBe(1)
    })

    // scenario: UsersList.withoutWorkCenter / edge cases / withoutWorkCenter=yes → 400
    it('withoutWorkCenter=yes answers 400 with the validation envelope', async () => {
      routeAuthContextToApp()
      const token = await createCaller(['readUsers'])

      const res = await list(token, 'withoutWorkCenter=yes')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('error.validation_failed')
      expect(res.body.error.message).toEqual(expect.any(String))
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'withoutWorkCenter' })]),
      )
    })

    // scenario: UsersList.withoutWorkCenter / authorization / [CRITICAL] no readUsers → 403
    it('answers 403 to a caller without readUsers, with or without the filter', async () => {
      routeAuthContextToApp()
      const token = await createCaller(['accessWebApp'])
      await seedThree()

      const filtered = await list(token, 'withoutWorkCenter=true')
      const plain = await list(token, '')

      expect(filtered.status).toBe(403)
      expect(filtered.body.error.code).toBe('auth.insufficient_permissions')
      expect(plain.status).toBe(403)
      expect(plain.body.error.code).toBe('auth.insufficient_permissions')
    })
  })

  it('has the two application privileges and no screen privileges', () => {
    expect(VALID_PRIVILEGE_CODES.has('accessWebApp')).toBe(true)
    expect(VALID_PRIVILEGE_CODES.has('accessOperatorPanel')).toBe(true)
    expect(PRIVILEGES.filter(p => p.code.endsWith('Screen'))).toEqual([])
  })

  // scenario: Privileges.applicationCodes / constraints / APPLICATION_PRIVILEGES
  it('defines exactly the two application privileges with their texts', () => {
    expect([...APPLICATION_PRIVILEGES]).toEqual([
      { code: 'accessWebApp', text: 'Access Web App' },
      { code: 'accessOperatorPanel', text: 'Access Operator Panel' },
    ])
  })

  // scenario: Privileges.applicationCodes / constraints / order of PRIVILEGES
  it('lists the two application privileges first', () => {
    expect(PRIVILEGES.slice(0, 2)).toEqual([...APPLICATION_PRIVILEGES])
  })
})
