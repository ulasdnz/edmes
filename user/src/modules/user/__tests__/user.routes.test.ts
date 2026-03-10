import type { Express, NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { initLoaders } from '../../../core/loaders/index.js'
import User from '../user.model.js'

vi.mock('../../../core/loaders/mongoose', () => ({
  initMongoose: vi.fn(),
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
  subscriberClient: {
    connect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    on: vi.fn(),
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
    expect(res.body.success).toBe(true)
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
    expect(res.body.success).toBe(false)
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
    expect(res.body.success).toBe(true)
    expect(res.body.data.token).toBeDefined()
  })

  it('POST /api/v1/auth/login should fail for invalid credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'nonexistent@example.com',
      password: 'wrongpassword',
    })

    expect(res.status).toBe(401)
  })
})
