import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheDel, cacheWrap, cacheWrapDedup } = vi.hoisted(() => ({
  cacheDel: vi.fn(async () => {}),
  cacheWrap: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()),
  cacheWrapDedup: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) =>
    loader(),
  ),
}))

vi.mock('../../lib/cache.js', () => ({
  cacheDel,
  cacheWrap,
  cacheWrapDedup,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDelPattern: vi.fn(),
  sharedCacheWrapDedup: vi.fn(),
  sharedCacheDel: vi.fn(),
}))

const { getLatest } = vi.hoisted(() => ({
  getLatest: vi.fn(async () => null as null | { tagId: string; value: number; occurredAt: string }),
}))

vi.mock('../../lib/internal-api/run-mode-telemetry.client.js', () => ({
  getLatest,
  getStateDurations: vi.fn(),
}))

const { getWorkCenter } = vi.hoisted(() => ({
  getWorkCenter: vi.fn(
    async (_id: string) =>
      null as unknown as {
        _id: string
        tagBindings?: { runModeTagId?: string }
      } | null,
  ),
}))

vi.mock('../../lib/internal-api/work-center.client.js', () => ({
  getById: getWorkCenter,
  invalidate: vi.fn(async () => {}),
}))

import { Reason } from '../reason/reason.model.js'
import { UnplannedStop } from '../unplanned-stop/unplanned-stop.model.js'
import { PlannedStop } from './planned-stop.model.js'
import * as service from './planned-stop.service.js'
import { patchPlannedStopSchema } from './planned-stop.validators.js'

const userId = new Types.ObjectId().toString()

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
