import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import type { Express, NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLoaders } from '../../../core/loaders/index.js'
import { OperatorCheckIn } from '../../operators/operators.model.js'
import { Calendar } from '../../schedule/schedule.model.js'
import * as scheduleService from '../../schedule/schedule.service.js'
import { Shift } from '../../shift/shift.model.js'
import WorkCenter from '../work-center.model.js'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@mes/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@mes/auth')>()),
  configureAuth: vi.fn(),
  buildAuthContextCacheKey: (userId: string) => `auth:ctx:${userId}`,
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    const wcHeader = req.header('x-work-center-ids')
    req.user = {
      id: req.header('x-user-id') ?? '507f1f77bcf86cd799439091',
      roles: [],
      permissions:
        req
          .header('x-permissions')
          ?.split(',')
          .map(permission => permission.trim())
          .filter(Boolean) ?? [],
      workCenterIds: wcHeader !== undefined ? wcHeader.split(',').filter(Boolean) : undefined,
    }
    next()
  },
  requirePermission: (permission: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
      if (req.user?.permissions?.includes('*') || req.user?.permissions?.includes(permission)) {
        next()
        return
      }

      res.status(403).json({
        error: {
          code: 'auth.insufficient_permissions',
          message: 'auth.insufficient_permissions',
        },
      })
    }
  },
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
let sequence = 0

const defaultFetchResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        docs: [],
        inUse: false,
        workCenterIds: [],
      },
    }),
  }) as Response

const nextSuffix = () => String(++sequence).padStart(4, '0')

const baseWeek = () => ({
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
})

const buildPhysicalWorkCenter = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const suffix = nextSuffix()

  return {
    code: `WC-${suffix}`,
    name: `Work Center ${suffix}`,
    type: 'physical',
    productivityMode: 'count_based',
    tagBindings: {
      productionCounterTagId: '507f1f77bcf86cd799439011',
      runModeTagId: '507f1f77bcf86cd799439012',
    },
    ...overrides,
  }
}

const buildVirtualWorkCenter = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const suffix = nextSuffix()

  return { code: `BLOCK-${suffix}`, name: `Block ${suffix}`, type: 'virtual', ...overrides }
}

const primaryComposition = (workCenterId: string) => {
  const rule = { rule: 'primary_work_center', contributors: [{ workCenterId }] }
  return { availability: rule, productivity: rule, quality: rule }
}

async function createInternalWorkCenter(payload: Record<string, unknown>): Promise<string> {
  const res = await request(app)
    .post('/internal/v1/work-centers')
    .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
    .send(payload)

  expect(res.status).toBe(201)

  return res.body.data._id as string
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock)
  app = await initLoaders()
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(defaultFetchResponse())
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('Work Center Spec Compliance Review', () => {
  it('matches the duplicate active operator check-in guard from the spec', async () => {
    const workCenterId = await createInternalWorkCenter(buildPhysicalWorkCenter())
    const operatorId = '507f1f77bcf86cd799439013'

    const first = await request(app)
      .post(`/internal/v1/work-centers/${workCenterId}/operators`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({ operatorId })

    const second = await request(app)
      .post(`/internal/v1/work-centers/${workCenterId}/operators`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({ operatorId })

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(await OperatorCheckIn.countDocuments({ workCenterId })).toBe(1)
  })

  it('returns the effective schedule for a given date', async () => {
    const shift = await Shift.create({
      name: 'Day Shift',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: '507f1f77bcf86cd799439091',
      updatedBy: '507f1f77bcf86cd799439091',
    })

    const workCenterId = await createInternalWorkCenter(
      buildPhysicalWorkCenter({
        shiftIds: [String(shift._id)],
      }),
    )

    const weeklyPattern = baseWeek()
    weeklyPattern.monday = [String(shift._id)]

    const calendarRes = await request(app)
      .post(`/internal/v1/work-centers/${workCenterId}/calendars`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({
        validFrom: '2026-03-01T00:00:00.000Z',
        validTo: '2026-03-31T00:00:00.000Z',
        weeklyPattern,
      })

    const effectiveSchedule = await request(app)
      .get(`/internal/v1/work-centers/${workCenterId}/schedule`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .query({ date: '2026-03-23' })

    const directSchedule = await scheduleService.getEffectiveSchedule(workCenterId, '2026-03-23')

    expect(calendarRes.status).toBe(201)
    expect(directSchedule.source).toBe('calendar')
    expect(directSchedule.date).toBe('2026-03-23')
    expect(directSchedule.shiftIds).toEqual([String(shift._id)])
    expect(directSchedule.shifts).toHaveLength(1)
    expect(effectiveSchedule.status).toBe(200)
    expect(effectiveSchedule.body.data.source).toBe('calendar')
  })

  it('matches the archive guard that blocks physical work centers with open check-ins', async () => {
    const workCenterId = await createInternalWorkCenter(buildPhysicalWorkCenter())

    const checkIn = await request(app)
      .post(`/internal/v1/work-centers/${workCenterId}/operators`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({ operatorId: '507f1f77bcf86cd799439015' })

    const archive = await request(app)
      .patch(`/internal/v1/work-centers/${workCenterId}`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({ status: 'archived' })

    expect(checkIn.status).toBe(201)
    expect(archive.status).toBe(400)
  })

  it('accepts date exception upserts on the internal API', async () => {
    const shift = await Shift.create({
      name: 'Maintenance Window',
      startHour: 10,
      startMinute: 0,
      endHour: 12,
      endMinute: 0,
      createdBy: '507f1f77bcf86cd799439091',
      updatedBy: '507f1f77bcf86cd799439091',
    })

    const workCenterId = await createInternalWorkCenter(buildPhysicalWorkCenter())

    const res = await request(app)
      .put(`/internal/v1/work-centers/${workCenterId}/exceptions/2026-03-23`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({
        shiftIds: [String(shift._id)],
      })

    expect(res.status).toBe(200)
    expect(res.body.data.shiftIds).toHaveLength(1)
  })

  it('enforces public visibility membership through user workCenterIds', async () => {
    const workCenterId = await createInternalWorkCenter(buildPhysicalWorkCenter())

    const denied = await request(app)
      .get(`/api/v1/work-centers/${workCenterId}`)
      .set('x-user-id', '507f1f77bcf86cd799439017')
      .set('x-permissions', 'readWorkCenters')
      .set('x-work-center-ids', '')

    const allowed = await request(app)
      .get(`/api/v1/work-centers/${workCenterId}`)
      .set('x-user-id', '507f1f77bcf86cd799439017')
      .set('x-permissions', 'readWorkCenters')
      .set('x-work-center-ids', workCenterId)

    expect(denied.status).toBe(404)
    expect(allowed.status).toBe(200)
    expect(allowed.body.data._id).toBe(workCenterId)
  })

  it('applies the same visibility to replacing, updating and deleting a work center', async () => {
    const payload = buildPhysicalWorkCenter()
    const workCenterId = await createInternalWorkCenter(payload)
    const { type: _type, ...replacement } = payload
    const outsider = (test: request.Test) =>
      test
        .set('x-user-id', '507f1f77bcf86cd799439017')
        .set('x-permissions', 'writeWorkCenters,deleteWorkCenters')
        .set('x-work-center-ids', '')

    const replaced = await outsider(request(app).put(`/api/v1/work-centers/${workCenterId}`)).send({
      ...replacement,
      name: 'Taken over',
    })
    const updated = await outsider(request(app).patch(`/api/v1/work-centers/${workCenterId}`)).send(
      { name: 'Taken over' },
    )
    const deleted = await outsider(request(app).delete(`/api/v1/work-centers/${workCenterId}`))

    expect(replaced.status).toBe(404)
    expect(updated.status).toBe(404)
    expect(deleted.status).toBe(404)
    expect(await WorkCenter.findById(workCenterId).lean()).toMatchObject({ name: payload.name })
  })

  it('applies the work center visibility to its operators and calendars', async () => {
    const workCenterId = await createInternalWorkCenter(buildPhysicalWorkCenter())
    const calendar = {
      validFrom: '2026-03-01T00:00:00.000Z',
      validTo: '2026-03-31T00:00:00.000Z',
      weeklyPattern: baseWeek(),
    }
    const someId = '507f1f77bcf86cd799439016'
    const routes = [
      ['post', 'operators', { operatorId: '507f1f77bcf86cd799439015' }],
      ['get', 'operators'],
      ['patch', `operators/${someId}`, {}],
      ['post', 'calendars', calendar],
      ['get', 'calendars'],
      ['get', `calendars/${someId}`],
      ['put', `calendars/${someId}`, calendar],
      ['patch', `calendars/${someId}`, {}],
      ['delete', `calendars/${someId}`],
      ['put', 'exceptions/2026-03-23', { shiftIds: [] }],
      ['delete', 'exceptions/2026-03-23'],
      ['get', 'schedule?date=2026-03-23'],
    ] as const

    for (const [method, path, body] of routes) {
      const res = await request(app)
        [method](`/api/v1/work-centers/${workCenterId}/${path}`)
        .set('x-user-id', '507f1f77bcf86cd799439017')
        .set('x-permissions', 'readOperators,writeOperators,readSchedules,writeSchedules')
        .set('x-work-center-ids', '')
        .send(body)

      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404)
    }
    expect(await OperatorCheckIn.countDocuments({ workCenterId })).toBe(0)
    expect(await Calendar.countDocuments({ workCenterId })).toBe(0)
  })

  // Otherwise a virtual work center with a hidden machine as its primary contributor would show
  // that machine's OEE to anyone who can create work centers.
  it('lets a caller reference only work centers they can see', async () => {
    const hiddenMachine = await createInternalWorkCenter(buildPhysicalWorkCenter())
    const hiddenBlock = await createInternalWorkCenter(buildVirtualWorkCenter())
    const ownBlock = await createInternalWorkCenter(buildVirtualWorkCenter())
    const asUser = (test: request.Test) =>
      test
        .set('x-user-id', '507f1f77bcf86cd799439017')
        .set('x-permissions', 'writeWorkCenters')
        .set('x-work-center-ids', ownBlock)

    const peek = await asUser(request(app).post('/api/v1/work-centers')).send(
      buildVirtualWorkCenter({ metricComposition: primaryComposition(hiddenMachine) }),
    )
    const recomposed = await asUser(request(app).patch(`/api/v1/work-centers/${ownBlock}`)).send({
      metricComposition: primaryComposition(hiddenMachine),
    })
    const adopted = await asUser(request(app).patch(`/api/v1/work-centers/${ownBlock}`)).send({
      parentWorkCenterId: hiddenBlock,
    })

    expect([peek.status, peek.body.error?.code]).toEqual([404, 'work_center.contributor_not_found'])
    expect([recomposed.status, recomposed.body.error?.code]).toEqual([
      404,
      'work_center.contributor_not_found',
    ])
    expect([adopted.status, adopted.body.error?.code]).toEqual([
      404,
      'work_center.parent_not_found',
    ])
  })

  it('lets a caller keep contributors they cannot see in a composition they edit', async () => {
    const hiddenMachine = await createInternalWorkCenter(buildPhysicalWorkCenter())
    const ownMachine = await createInternalWorkCenter(buildPhysicalWorkCenter())
    const block = await createInternalWorkCenter(
      buildVirtualWorkCenter({ metricComposition: primaryComposition(hiddenMachine) }),
    )

    const res = await request(app)
      .patch(`/api/v1/work-centers/${block}`)
      .set('x-user-id', '507f1f77bcf86cd799439017')
      .set('x-permissions', 'writeWorkCenters')
      .set('x-work-center-ids', `${block},${ownMachine}`)
      .send({
        metricComposition: {
          ...primaryComposition(hiddenMachine),
          productivity: {
            rule: 'primary_work_center',
            contributors: [{ workCenterId: ownMachine }],
          },
        },
      })

    expect(res.status).toBe(200)
  })

  // A contributor without a weight is stored with weight: null, and a composition comes back
  // that way: editing it must not reject what the service itself saved.
  it('merges a partial composition into one whose contributors have no weight', async () => {
    const first = await createInternalWorkCenter(buildPhysicalWorkCenter())
    const second = await createInternalWorkCenter(buildPhysicalWorkCenter())
    const block = await createInternalWorkCenter(
      buildVirtualWorkCenter({ metricComposition: primaryComposition(first) }),
    )

    const res = await request(app)
      .patch(`/internal/v1/work-centers/${block}`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({
        partialMetricComposition: {
          productivity: { rule: 'primary_work_center', contributors: [{ workCenterId: second }] },
        },
      })

    expect(res.status).toBe(200)
    const { availability, productivity } = res.body.data.metricComposition
    expect(availability.contributors[0].workCenterId).toBe(first)
    expect(productivity.contributors[0].workCenterId).toBe(second)
  })

  it('replaces a virtual work center with the composition it was read with', async () => {
    const machine = await createInternalWorkCenter(buildPhysicalWorkCenter())
    const block = await createInternalWorkCenter(
      buildVirtualWorkCenter({ metricComposition: primaryComposition(machine) }),
    )
    const read = await request(app)
      .get(`/internal/v1/work-centers/${block}`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
    const { code, name, metricComposition } = read.body.data

    const res = await request(app)
      .put(`/internal/v1/work-centers/${block}`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({ code, name, metricComposition })

    expect(res.status).toBe(200)
  })

  it('proves physical create silently strips virtual-only fields instead of rejecting them', async () => {
    const res = await request(app)
      .post('/internal/v1/work-centers')
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({
        ...buildPhysicalWorkCenter(),
        metricComposition: {
          availability: {
            rule: 'primary_work_center',
            contributors: [{ workCenterId: '507f1f77bcf86cd799439018' }],
          },
          productivity: {
            rule: 'primary_work_center',
            contributors: [{ workCenterId: '507f1f77bcf86cd799439018' }],
          },
          quality: {
            rule: 'primary_work_center',
            contributors: [{ workCenterId: '507f1f77bcf86cd799439018' }],
          },
        },
      })

    const saved = await WorkCenter.findById(res.body.data._id).lean()

    expect(res.status).toBe(201)
    expect(saved?.type).toBe('physical')
    expect(saved?.metricComposition).toBeNull()
  })

  it('rejects a micro stop threshold, which only the performance policy holds', async () => {
    const machine = await createInternalWorkCenter(buildPhysicalWorkCenter())

    const res = await request(app)
      .patch(`/internal/v1/work-centers/${machine}`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({ microStopThresholdMs: 60_000 })

    expect(res.status).toBe(400)
  })

  it('rejects overlapping shifts in calendar weekly pattern', async () => {
    const morning = await Shift.create({
      name: 'Morning',
      startHour: 8,
      startMinute: 0,
      endHour: 12,
      endMinute: 0,
      createdBy: '507f1f77bcf86cd799439091',
      updatedBy: '507f1f77bcf86cd799439091',
    })
    const overlap = await Shift.create({
      name: 'Overlap',
      startHour: 11,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: '507f1f77bcf86cd799439091',
      updatedBy: '507f1f77bcf86cd799439091',
    })

    const workCenterId = await createInternalWorkCenter(buildPhysicalWorkCenter())

    const overlappingWeek = baseWeek()
    overlappingWeek.monday = [String(morning._id), String(overlap._id)]

    const res = await request(app)
      .post(`/internal/v1/work-centers/${workCenterId}/calendars`)
      .set(INTERNAL_TOKEN_HEADER, process.env.INTERNAL_API_TOKEN as string)
      .send({
        validFrom: '2026-03-01T00:00:00.000Z',
        validTo: '2026-03-31T00:00:00.000Z',
        weeklyPattern: overlappingWeek,
      })

    expect(res.status).toBe(400)
    expect(await Calendar.countDocuments({ workCenterId })).toBe(0)
  })
})
