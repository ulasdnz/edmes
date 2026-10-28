import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import type { Express, NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLoaders } from '../../../core/loaders/index.js'
import WorkCenter from '../../work-center/work-center.model.js'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@mes/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@mes/auth')>()),
  configureAuth: vi.fn(),
  buildAuthContextCacheKey: (userId: string) => `auth:ctx:${userId}`,
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = {
      id: '507f1f77bcf86cd799439091',
      roles: [],
      permissions: ['*'],
      workCenterIds: [],
    }
    next()
  },
  requirePermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
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

let app: Express
let seq = 0
const nextCode = () => `WC-RM-${String(++seq).padStart(4, '0')}`

const SYSTEM_USER_ID = new mongoose.Types.ObjectId('507f1f77bcf86cd799439091')

async function insertWorkCenter(doc: Record<string, unknown>) {
  return WorkCenter.create({
    code: nextCode(),
    name: `WC ${seq}`,
    status: 'active',
    createdBy: SYSTEM_USER_ID,
    updatedBy: SYSTEM_USER_ID,
    ...doc,
  })
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock)
  app = await initLoaders()
})

beforeEach(async () => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { docs: [], inUse: false, workCenterIds: [] } }),
  } as Response)
  await WorkCenter.deleteMany({})
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('GET /internal/v1/work-centers/run-mode-monitors', () => {
  it('returns only physical + active WCs that have tagBindings.runModeTagId', async () => {
    const runModeTagId = new mongoose.Types.ObjectId()
    const included = await insertWorkCenter({
      type: 'physical',
      status: 'active',
      productivityMode: 'count_based',
      tagBindings: {
        productionCounterTagId: new mongoose.Types.ObjectId(),
        runModeTagId,
      },
    })

    await insertWorkCenter({
      type: 'physical',
      status: 'archived',
      productivityMode: 'count_based',
      tagBindings: {
        productionCounterTagId: new mongoose.Types.ObjectId(),
        runModeTagId: new mongoose.Types.ObjectId(),
      },
    })

    await insertWorkCenter({
      type: 'physical',
      status: 'active',
      productivityMode: 'count_based',
    })

    await insertWorkCenter({
      type: 'virtual',
      status: 'active',
    })

    const res = await request(app)
      .get('/internal/v1/work-centers/run-mode-monitors')
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toEqual({
      workCenterId: included._id.toString(),
      runModeTagId: runModeTagId.toString(),
    })
  })

  it('response shape contains only workCenterId and runModeTagId', async () => {
    await insertWorkCenter({
      type: 'physical',
      status: 'active',
      productivityMode: 'count_based',
      tagBindings: {
        productionCounterTagId: new mongoose.Types.ObjectId(),
        runModeTagId: new mongoose.Types.ObjectId(),
      },
    })

    const res = await request(app)
      .get('/internal/v1/work-centers/run-mode-monitors')
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['runModeTagId', 'workCenterId'])
  })

  it('returns empty array when no monitored work centers exist', async () => {
    await insertWorkCenter({ type: 'virtual', status: 'active' })

    const res = await request(app)
      .get('/internal/v1/work-centers/run-mode-monitors')
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })
})
