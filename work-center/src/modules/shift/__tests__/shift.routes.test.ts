import type { NextFunction, Request, Response } from 'express'
import { Types } from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLoaders } from '../../../core/loaders/index.js'
import { Shift } from '../shift.model.js'

vi.mock('@mes/auth', () => ({
  configureAuth: vi.fn(),
  buildAuthContextCacheKey: (userId: string) => `auth:ctx:${userId}`,
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = {
      id: req.header('x-user-id') ?? '507f1f77bcf86cd799439091',
      roles: [],
      permissions: ['*'],
      workCenterIds: [],
    }
    next()
  },
  requirePermission: (_permission: string) => (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}))

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
  morganMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
  httpLoggerMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}))

vi.mock('../../../jobs/events.js', () => ({
  emitShiftCreated: vi.fn(),
  emitShiftUpdated: vi.fn(),
  emitShiftDeleted: vi.fn(),
  emitShiftStarted: vi.fn(),
  emitShiftEnded: vi.fn(),
  emitScheduleChanged: vi.fn(),
  emitOperatorCheckedIn: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
  emitWorkCenterCreated: vi.fn(),
  emitWorkCenterUpdated: vi.fn(),
  emitWorkCenterArchived: vi.fn(),
  emitWorkCenterReactivated: vi.fn(),
  emitWorkCenterDeleted: vi.fn(),
  emitHierarchyChanged: vi.fn(),
  emitMetricCompositionChanged: vi.fn(),
}))

vi.mock('../shift.scheduler.js', () => ({
  onShiftCreated: vi.fn(),
  onShiftUpdated: vi.fn(),
  onShiftDeleted: vi.fn(),
  startShiftScheduler: vi.fn(),
  stopShiftScheduler: vi.fn(),
}))

vi.mock('../../../lib/internal-api.js', () => ({
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
  addWorkCenterToUser: vi.fn(),
  isWorkCenterReferencedByUsers: vi.fn().mockResolvedValue(false),
  validateOperatorExists: vi.fn().mockResolvedValue(true),
}))

let app: Awaited<ReturnType<typeof initLoaders>>

beforeAll(async () => {
  app = await initLoaders()
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('shift routes (internal)', () => {
  beforeEach(async () => {
    await Shift.deleteMany({})
  })

  it('POST /internal/v1/shifts creates a shift', async () => {
    const res = await request(app)
      .post('/internal/v1/shifts')
      .send({ name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 })
    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Day')
  })

  it('GET /internal/v1/shifts returns the list', async () => {
    await request(app)
      .post('/internal/v1/shifts')
      .send({ name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 })
    const res = await request(app).get('/internal/v1/shifts')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('GET /internal/v1/shifts/:id returns a single shift', async () => {
    const create = await request(app)
      .post('/internal/v1/shifts')
      .send({ name: 'Night', startHour: 22, startMinute: 0, endHour: 6, endMinute: 0 })
    const id = create.body.data._id
    const res = await request(app).get(`/internal/v1/shifts/${id}`)
    expect(res.status).toBe(200)
    expect(res.body.data._id).toBe(id)
    expect(res.body.data.name).toBe('Night')
  })

  it('GET /internal/v1/shifts/:id returns 404 for unknown id', async () => {
    const res = await request(app).get(`/internal/v1/shifts/${new Types.ObjectId().toHexString()}`)
    expect(res.status).toBe(404)
  })

  it('PATCH /internal/v1/shifts/:id updates a shift', async () => {
    const create = await request(app)
      .post('/internal/v1/shifts')
      .send({ name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 })
    const id = create.body.data._id
    const res = await request(app).patch(`/internal/v1/shifts/${id}`).send({ name: 'Day Updated' })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Day Updated')
  })

  it('DELETE /internal/v1/shifts/:id works when no references', async () => {
    const create = await request(app)
      .post('/internal/v1/shifts')
      .send({ name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 })
    const id = create.body.data._id
    const del = await request(app).delete(`/internal/v1/shifts/${id}`)
    expect(del.status).toBe(200)
    expect(await Shift.countDocuments({ _id: id })).toBe(0)
  })
})
