import { CustomError } from '@mes/core'
import { profileOperations } from '@mes/testing'
import { Types } from 'mongoose'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'
import type * as workCenter from '../../lib/internal-api/work-center.client.js'

// Events and the cache go to Redis, so a real one runs. Performance builds its Redis clients from
// REDIS_URL when their module loads, so Redis starts before the imports below run.
const { redis } = await vi.hoisted(async () => {
  const { startRedisTestContainer } = await import('@mes/testing')
  const redis = await startRedisTestContainer()
  process.env.REDIS_URL = redis.url
  return { redis }
})

const { getLatest } = vi.hoisted(() => ({
  getLatest: vi.fn(async () => null as null | { tagId: string; value: number; occurredAt: string }),
}))

vi.mock('../../lib/internal-api/run-mode-telemetry.client.js', () => ({
  getLatest,
  getStateDurations: vi.fn(),
}))

const { getWorkCenter } = vi.hoisted(() => ({
  getWorkCenter: vi.fn<typeof workCenter.getById>(async () => null),
}))

vi.mock('../../lib/internal-api/work-center.client.js', () => ({
  getById: getWorkCenter,
  invalidate: vi.fn(async () => {}),
}))

import { logger } from '../../lib/logger.js'
import { closeRedis, initRedis, redisClient } from '../../lib/redis.js'
import { bootstrapSystemReasons } from '../reason/reason.bootstrap.js'
import { Reason } from '../reason/reason.model.js'
import { UnplannedStop } from '../unplanned-stop/unplanned-stop.model.js'
import { PlannedStop } from './planned-stop.model.js'
import * as service from './planned-stop.service.js'
import { patchPlannedStopSchema } from './planned-stop.validators.js'

const userId = new Types.ObjectId().toString()

beforeAll(async () => {
  await initRedis()
})

afterAll(async () => {
  await closeRedis()
  await redis.stop()
})

// The database is emptied after every test, so the cache is too
beforeEach(async () => {
  await redisClient.flushall()
})

async function seedPlannedReason(
  overrides: Partial<{ canStartManually: boolean; isActive: boolean }> = {},
) {
  return Reason.create({
    code: `R-${new Types.ObjectId().toString()}`,
    name: 'Planned Reason',
    usages: ['planned_stop'],
    canStartManually: overrides.canStartManually ?? true,
    canBeScheduled: false,
    canConvertFromUnplanned: false,
    isSystemDefault: false,
    isActive: overrides.isActive ?? true,
    affectsOee: false,
    createdBy: new Types.ObjectId(userId),
  })
}

describe('PlannedStopService', () => {
  beforeEach(() => {
    getLatest.mockReset()
    getWorkCenter.mockReset()
    getLatest.mockResolvedValue(null)
    getWorkCenter.mockResolvedValue(null)
  })

  describe('create', () => {
    it('creates a planned stop with status="planned"', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const doc = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      expect(doc.status).toBe('planned')
      expect(doc.source).toBe('manual')
    })

    it('rejects invalid window (end <= start)', async () => {
      const reason = await seedPlannedReason()
      await expect(
        service.create(
          {
            workCenterId: new Types.ObjectId().toString(),
            reasonId: reason._id.toString(),
            plannedOwnerId: new Types.ObjectId().toString(),
            plannedStartAt: new Date('2026-06-15T11:00:00.000Z'),
            plannedEndAt: new Date('2026-06-15T10:00:00.000Z'),
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.planned_stop_invalid_window',
      })
    })

    it('rejects overlapping planned stops on the same work center', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const base = {
        workCenterId: wcId,
        reasonId: reason._id.toString(),
        plannedOwnerId: new Types.ObjectId().toString(),
      }
      await service.create(
        {
          ...base,
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      await expect(
        service.create(
          {
            ...base,
            plannedStartAt: new Date('2026-06-15T10:30:00.000Z'),
            plannedEndAt: new Date('2026-06-15T11:30:00.000Z'),
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'error.planned_stop_overlap',
      })
    })

    it('rejects when reason lacks canStartManually', async () => {
      const reason = await seedPlannedReason({ canStartManually: false })
      await expect(
        service.create(
          {
            workCenterId: new Types.ObjectId().toString(),
            reasonId: reason._id.toString(),
            plannedOwnerId: new Types.ObjectId().toString(),
            plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
            plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.reason_canStartManually_denied',
      })
    })

    it('supports backdated closed create with actualStart/End', async () => {
      const reason = await seedPlannedReason()
      const doc = await service.create(
        {
          workCenterId: new Types.ObjectId().toString(),
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T09:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T10:00:00.000Z'),
          actualStartAt: new Date('2026-06-15T09:00:00.000Z'),
          actualEndAt: new Date('2026-06-15T10:00:00.000Z'),
          status: 'closed',
        },
        userId,
      )
      expect(doc.status).toBe('closed')
      expect(doc.actualStartAt).not.toBeNull()
    })

    it('rejects backdated closed create without actuals', async () => {
      const reason = await seedPlannedReason()
      await expect(
        service.create(
          {
            workCenterId: new Types.ObjectId().toString(),
            reasonId: reason._id.toString(),
            plannedOwnerId: new Types.ObjectId().toString(),
            plannedStartAt: new Date('2026-06-15T09:00:00.000Z'),
            plannedEndAt: new Date('2026-06-15T10:00:00.000Z'),
            status: 'closed',
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.planned_stop_closed_requires_actuals',
      })
    })
  })

  describe('start', () => {
    it('closes open unplanned stop and switches status to active', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const stop = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )

      await UnplannedStop.create({
        workCenterId: new Types.ObjectId(wcId),
        source: 'run_mode',
        startAt: new Date('2026-06-15T09:50:00.000Z'),
      })

      const started = await service.start(stop._id.toString(), userId, {
        actualStartAt: new Date('2026-06-15T10:00:00.000Z'),
      })
      expect(started.status).toBe('active')
      expect(started.actualStartAt).not.toBeNull()

      const remainingOpen = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(remainingOpen).toBeNull()
    })

    it('leaves a stop that started after a retroactive start open', async () => {
      await bootstrapSystemReasons()
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const stop = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T12:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T13:00:00.000Z'),
        },
        userId,
      )
      // The machine stopped at 12:05; the planned stop is entered later as started at 12:00
      await UnplannedStop.create({
        workCenterId: new Types.ObjectId(wcId),
        source: 'run_mode',
        startAt: new Date('2026-06-15T12:05:00.000Z'),
      })

      await service.start(stop._id.toString(), userId, {
        actualStartAt: new Date('2026-06-15T12:00:00.000Z'),
      })

      // No stop ends before it starts: this one closes at its own running signal
      const stops = await UnplannedStop.find({ workCenterId: new Types.ObjectId(wcId) }).lean()
      expect(stops.map(({ startAt, endAt }) => ({ startAt, endAt }))).toEqual([
        { startAt: new Date('2026-06-15T12:05:00.000Z'), endAt: null },
      ])
    })

    it('rejects concurrent start when another active planned exists (race guard)', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()

      const a = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      const b = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T12:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T13:00:00.000Z'),
        },
        userId,
      )

      await service.start(a._id.toString(), userId)
      await expect(service.start(b._id.toString(), userId)).rejects.toMatchObject({
        statusCode: 409,
      })
    })
  })

  describe('close', () => {
    it('closes an active planned stop and skips run-mode unplanned when value>=1', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const stop = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      await service.start(stop._id.toString(), userId, {
        actualStartAt: new Date('2026-06-15T10:00:00.000Z'),
      })
      getWorkCenter.mockResolvedValueOnce({
        _id: wcId,
        type: 'machine',
        tagBindings: { runModeTagId: new Types.ObjectId().toString() },
      })
      getLatest.mockResolvedValueOnce({
        tagId: 'x',
        value: 1,
        occurredAt: '2026-06-15T10:30:00.000Z',
      })
      const closed = await service.close(
        stop._id.toString(),
        { actualEndAt: new Date('2026-06-15T10:30:00.000Z') },
        userId,
      )
      expect(closed.status).toBe('closed')
      const openUnplanned = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(openUnplanned).toBeNull()
    })

    it('closes the planned stop when the work center service cannot be reached', async () => {
      // spyOn would type the calls by winston's last overload, which takes no meta argument
      const warn: MockInstance = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
      try {
        const reason = await seedPlannedReason()
        const wcId = new Types.ObjectId().toString()
        const stop = await service.create(
          {
            workCenterId: wcId,
            reasonId: reason._id.toString(),
            plannedOwnerId: new Types.ObjectId().toString(),
            plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
            plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
          },
          userId,
        )
        await service.start(stop._id.toString(), userId, {
          actualStartAt: new Date('2026-06-15T10:00:00.000Z'),
        })
        getWorkCenter.mockRejectedValueOnce(new CustomError(503, 'error.work_center_unreachable'))

        const closed = await service.close(
          stop._id.toString(),
          { actualEndAt: new Date('2026-06-15T10:30:00.000Z') },
          userId,
        )

        expect(closed.status).toBe('closed')
        // No signal of the work center was processed either, so no cursor names its run-mode tag
        expect(warn.mock.calls.map(([, meta]) => meta)).toContainEqual({
          event: 'planned_stop.run_mode_unmonitored',
          plannedStopId: stop._id.toString(),
          workCenterId: wcId,
          actualEndAt: '2026-06-15T10:30:00.000Z',
        })
      } finally {
        warn.mockRestore()
      }
    })

    it('opens unplanned when value<1 after close and no covering planned exists', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const stop = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      await service.start(stop._id.toString(), userId, {
        actualStartAt: new Date('2026-06-15T10:00:00.000Z'),
      })
      getWorkCenter.mockResolvedValue({
        _id: wcId,
        type: 'machine',
        tagBindings: { runModeTagId: new Types.ObjectId().toString() },
      })
      getLatest.mockResolvedValue({
        tagId: 'x',
        value: 0,
        occurredAt: '2026-06-15T10:30:00.000Z',
      })
      await service.close(
        stop._id.toString(),
        { actualEndAt: new Date('2026-06-15T10:30:00.000Z') },
        userId,
      )
      const openUnplanned = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(openUnplanned).not.toBeNull()
      expect(openUnplanned?.source).toBe('run_mode')
    })

    it('rejects close on a non-active stop', async () => {
      const reason = await seedPlannedReason()
      const stop = await service.create(
        {
          workCenterId: new Types.ObjectId().toString(),
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      await expect(service.close(stop._id.toString(), {}, userId)).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.planned_stop_not_active',
      })
    })
  })

  describe('update', () => {
    it('rejects window change when status is not planned', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const stop = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      await service.start(stop._id.toString(), userId)
      await expect(
        service.update(
          stop._id.toString(),
          { plannedEndAt: new Date('2026-06-15T12:00:00.000Z') },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.planned_stop_window_locked',
      })
    })
  })

  describe('cancel / remove', () => {
    it('cancels a planned stop and blocks remove of an active stop', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const stop = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      const cancelled = await service.cancel(stop._id.toString(), userId)
      expect(cancelled.status).toBe('cancelled')

      const stop2 = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T14:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T15:00:00.000Z'),
        },
        userId,
      )
      await service.start(stop2._id.toString(), userId)
      await expect(service.remove(stop2._id.toString())).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.planned_stop_active_cannot_delete',
      })
    })
  })

  describe('patch validator — workCenterId immutable', () => {
    it('rejects workCenterId with specific i18n code', () => {
      const res = patchPlannedStopSchema.safeParse({
        workCenterId: new Types.ObjectId().toString(),
        description: 'x',
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        const messages = res.error.issues.map(i => i.message)
        expect(messages).toContain('error.planned_stop_work_center_immutable')
      }
    })

    it('accepts a non-workCenterId patch', () => {
      const res = patchPlannedStopSchema.safeParse({ description: 'foo' })
      expect(res.success).toBe(true)
    })
  })

  describe('list by status', () => {
    it('filters by status=active', async () => {
      const reason = await seedPlannedReason()
      const wcId = new Types.ObjectId().toString()
      const stop = await service.create(
        {
          workCenterId: wcId,
          reasonId: reason._id.toString(),
          plannedOwnerId: new Types.ObjectId().toString(),
          plannedStartAt: new Date('2026-06-15T10:00:00.000Z'),
          plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        },
        userId,
      )
      await service.start(stop._id.toString(), userId)

      const res = await service.list({ status: 'active' })
      expect(res.data.map(d => d._id.toString())).toContain(stop._id.toString())

      const cancelledList = await service.list({ status: 'cancelled' })
      expect(cancelledList.data.map(d => d._id.toString())).not.toContain(stop._id.toString())
      // prevent "unused variable" warnings from linters
      expect(PlannedStop.modelName).toBe('PlannedStop')
    })
  })
})

describe('PlannedStopService list index', () => {
  it("pages the planned stops of the caller's work centers from an index, newest first", async () => {
    await PlannedStop.createIndexes()
    const workCenters = Array.from({ length: 12 }, () => new Types.ObjectId())
    await PlannedStop.collection.insertMany(
      workCenters.flatMap((workCenterId, w) =>
        Array.from({ length: 100 }, (_, i) => {
          const at = new Date(Date.UTC(2026, 0, 1, 0, w * 100 + i))
          return {
            workCenterId,
            reasonId: new Types.ObjectId(),
            plannedOwnerId: new Types.ObjectId(userId),
            source: 'manual',
            startMode: 'manual',
            status: 'closed',
            plannedStartAt: at,
            plannedEndAt: new Date(at.getTime() + 600_000),
            createdAt: at,
          }
        }),
      ),
    )

    const { result, operations } = await profileOperations(
      PlannedStop.collection.collectionName,
      () =>
        service.list({
          page: 1,
          limit: 20,
          accessibleWorkCenterIds: workCenters.slice(0, 3).map(String),
        }),
    )

    expect(result.data).toHaveLength(20)
    const find = operations.find(op => op.op === 'query')
    expect(find?.planSummary).toContain('IXSCAN { workCenterId: 1, createdAt: -1, _id: -1 }')
    expect(find?.hasSortStage).toBeFalsy()
    expect(find?.keysExamined).toBeLessThanOrEqual(3 * 21)
  })
})
