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
  getWorkCenter: vi.fn(async () => null as unknown as { _id: string } | null),
}))

vi.mock('../../lib/internal-api/work-center.client.js', () => ({
  getById: getWorkCenter,
  invalidate: vi.fn(async () => {}),
}))

import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import { bootstrapSystemReasons, MICRO_STOP_CODE } from '../reason/reason.bootstrap.js'
import { Reason } from '../reason/reason.model.js'
import { UnplannedStop } from '../unplanned-stop/unplanned-stop.model.js'
import { PlannedStopTemplate } from './planned-stop-template.model.js'
import * as service from './planned-stop-template.service.js'

const userId = new Types.ObjectId().toString()

async function seedPlannedReason() {
  return Reason.create({
    code: `R-${new Types.ObjectId().toString()}`,
    name: 'Break',
    usages: ['planned_stop'],
    canStartManually: true,
    canBeScheduled: false,
    canConvertFromUnplanned: false,
    isSystemDefault: false,
    isActive: true,
    affectsOee: false,
    createdBy: new Types.ObjectId(userId),
  })
}

async function seedUnplannedReason() {
  return Reason.create({
    code: `R-${new Types.ObjectId().toString()}`,
    name: 'Overrun',
    usages: ['unplanned_stop'],
    canStartManually: false,
    canBeScheduled: false,
    canConvertFromUnplanned: false,
    isSystemDefault: false,
    isActive: true,
    affectsOee: true,
    createdBy: new Types.ObjectId(userId),
  })
}

async function createTemplate(overrides: Partial<Parameters<typeof service.create>[0]> = {}) {
  const reason = await seedPlannedReason()
  return service.create(
    {
      reasonId: reason._id.toString(),
      name: 'Tea break',
      defaultDurationMs: 15 * 60 * 1000,
      overrunPolicy: 'split_to_unplanned',
      ...overrides,
    } as Parameters<typeof service.create>[0],
    userId,
  )
}

describe('PlannedStopTemplateService', () => {
  beforeEach(async () => {
    await bootstrapSystemReasons()
    getLatest.mockReset()
    getWorkCenter.mockReset()
    getLatest.mockResolvedValue(null)
    getWorkCenter.mockResolvedValue(null)
  })

  describe('create', () => {
    it('creates a template', async () => {
      const tpl = await createTemplate()
      expect(tpl.name).toBe('Tea break')
      expect(tpl.overrunPolicy).toBe('split_to_unplanned')
    })

    it('rejects invalid duration', async () => {
      const reason = await seedPlannedReason()
      await expect(
        service.create(
          {
            reasonId: reason._id.toString(),
            name: 'Bad',
            defaultDurationMs: 0,
            overrunPolicy: 'alert_only',
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.planned_stop_template_invalid_duration',
      })
    })

    it('rejects reason with wrong usage', async () => {
      const badReason = await Reason.create({
        code: `R-${new Types.ObjectId().toString()}`,
        name: 'Unplanned',
        usages: ['unplanned_stop'],
        canStartManually: false,
        canBeScheduled: false,
        canConvertFromUnplanned: false,
        isSystemDefault: false,
        isActive: true,
        affectsOee: true,
        createdBy: new Types.ObjectId(userId),
      })
      await expect(
        service.create(
          {
            reasonId: badReason._id.toString(),
            name: 'Wrong',
            defaultDurationMs: 60_000,
            overrunPolicy: 'alert_only',
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.reason_usage_mismatch',
      })
    })
  })

  describe('startFromTemplate', () => {
    it('creates planned stop directly as active and closes any open unplanned', async () => {
      const tpl = await createTemplate()
      const wcId = new Types.ObjectId().toString()

      await UnplannedStop.create({
        workCenterId: new Types.ObjectId(wcId),
        source: 'run_mode',
        startAt: new Date('2026-06-15T09:50:00.000Z'),
      })

      const planned = await service.startFromTemplate(
        tpl._id.toString(),
        {
          workCenterId: wcId,
          actualStartAt: new Date('2026-06-15T10:00:00.000Z'),
        },
        userId,
      )
      expect(planned.status).toBe('active')
      expect(planned.source).toBe('template')
      expect(planned.actualStartAt).not.toBeNull()

      const open = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(open).toBeNull()
    })

    it('is race-guarded: concurrent starts yield 409', async () => {
      const tpl = await createTemplate()
      const wcId = new Types.ObjectId().toString()

      await service.startFromTemplate(
        tpl._id.toString(),
        {
          workCenterId: wcId,
          actualStartAt: new Date('2026-06-15T10:00:00.000Z'),
        },
        userId,
      )
      await expect(
        service.startFromTemplate(
          tpl._id.toString(),
          {
            workCenterId: wcId,
            actualStartAt: new Date('2026-06-15T10:00:30.000Z'),
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'error.planned_stop_active_exists',
      })
    })

    it('rejects when workCenter not in allow-list', async () => {
      const wcAllowed = new Types.ObjectId().toString()
      const wcOther = new Types.ObjectId().toString()
      const tpl = await createTemplate({
        workCenterIds: [wcAllowed],
      })
      await expect(
        service.startFromTemplate(
          tpl._id.toString(),
          {
            workCenterId: wcOther,
            actualStartAt: new Date('2026-06-15T10:00:00.000Z'),
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.planned_stop_template_work_center_not_allowed',
      })
    })

    it('rejects inactive template', async () => {
      const tpl = await createTemplate()
      await service.update(tpl._id.toString(), { isActive: false }, userId)
      await expect(
        service.startFromTemplate(
          tpl._id.toString(),
          {
            workCenterId: new Types.ObjectId().toString(),
            actualStartAt: new Date('2026-06-15T10:00:00.000Z'),
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.planned_stop_template_inactive',
      })
    })

    it('creates two distinct planned stops on two different work centers', async () => {
      const tpl = await createTemplate()
      const wcA = new Types.ObjectId().toString()
      const wcB = new Types.ObjectId().toString()
      const a = await service.startFromTemplate(
        tpl._id.toString(),
        { workCenterId: wcA, actualStartAt: new Date('2026-06-15T10:00:00.000Z') },
        userId,
      )
      const b = await service.startFromTemplate(
        tpl._id.toString(),
        { workCenterId: wcB, actualStartAt: new Date('2026-06-15T10:00:00.000Z') },
        userId,
      )
      expect(a._id.toString()).not.toBe(b._id.toString())
      const count = await PlannedStop.countDocuments({ templateId: tpl._id })
      expect(count).toBe(2)
    })
  })

  describe('closeFromTemplate', () => {
    it('with split_to_unplanned: records a CLOSED overrun unplanned stop when actual > planned end', async () => {
      const overrunReason = await seedUnplannedReason()
      const tpl = await createTemplate({
        overrunPolicy: 'split_to_unplanned',
        overrunReasonId: overrunReason._id.toString(),
      })
      const wcId = new Types.ObjectId().toString()
      const planned = await service.startFromTemplate(
        tpl._id.toString(),
        { workCenterId: wcId, actualStartAt: new Date('2026-06-15T10:00:00.000Z') },
        userId,
      )
      // Default duration 15 min → plannedEndAt=10:15. Close at 10:30 (15-min overrun).
      getWorkCenter.mockResolvedValue({
        _id: wcId,
        type: 'machine',
        tagBindings: { runModeTagId: new Types.ObjectId().toString() },
      } as never)
      // Simulate value >= 1 so maybeOpenUnplannedAfterClose does NOT open a run_mode one.
      getLatest.mockResolvedValue({
        tagId: 'x',
        value: 1,
        occurredAt: '2026-06-15T10:30:00.000Z',
      })
      await service.closeFromTemplate(planned._id.toString(), userId, {
        actualEndAt: new Date('2026-06-15T10:30:00.000Z'),
      })

      // Overrun = closed interval [plannedEndAt=10:15, actualEndAt=10:30]
      const overrun = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        source: 'manual',
        reasonId: overrunReason._id,
      }).lean()
      expect(overrun).not.toBeNull()
      expect(overrun?.startAt.toISOString()).toBe('2026-06-15T10:15:00.000Z')
      expect(overrun?.endAt).not.toBeNull()
      expect(overrun?.endAt?.toISOString()).toBe('2026-06-15T10:30:00.000Z')
      expect(overrun?.closedBy).not.toBeNull()
    })

    it('with extend_planned_until_close: extends plannedEndAt to actualEndAt', async () => {
      const tpl = await createTemplate({
        overrunPolicy: 'extend_planned_until_close',
      })
      const wcId = new Types.ObjectId().toString()
      const planned = await service.startFromTemplate(
        tpl._id.toString(),
        { workCenterId: wcId, actualStartAt: new Date('2026-06-15T10:00:00.000Z') },
        userId,
      )
      getWorkCenter.mockResolvedValue({
        _id: wcId,
        type: 'machine',
        tagBindings: { runModeTagId: new Types.ObjectId().toString() },
      } as never)
      getLatest.mockResolvedValue({
        tagId: 'x',
        value: 1,
        occurredAt: '2026-06-15T10:30:00.000Z',
      })
      await service.closeFromTemplate(planned._id.toString(), userId, {
        actualEndAt: new Date('2026-06-15T10:30:00.000Z'),
      })
      const closed = await PlannedStop.findById(planned._id).lean()
      expect(closed?.plannedEndAt.toISOString()).toBe('2026-06-15T10:30:00.000Z')
      expect(closed?.status).toBe('closed')
    })

    it('does NOT open overrun unplanned when actual <= planned end', async () => {
      const overrunReason = await seedUnplannedReason()
      const tpl = await createTemplate({
        overrunPolicy: 'split_to_unplanned',
        overrunReasonId: overrunReason._id.toString(),
      })
      const wcId = new Types.ObjectId().toString()
      const planned = await service.startFromTemplate(
        tpl._id.toString(),
        { workCenterId: wcId, actualStartAt: new Date('2026-06-15T10:00:00.000Z') },
        userId,
      )
      getWorkCenter.mockResolvedValue({
        _id: wcId,
        type: 'machine',
        tagBindings: { runModeTagId: new Types.ObjectId().toString() },
      } as never)
      getLatest.mockResolvedValue({
        tagId: 'x',
        value: 1,
        occurredAt: '2026-06-15T10:10:00.000Z',
      })
      await service.closeFromTemplate(planned._id.toString(), userId, {
        actualEndAt: new Date('2026-06-15T10:10:00.000Z'),
      })
      const microStopId = (
        await Reason.findOne({ code: MICRO_STOP_CODE, isSystemDefault: true }).lean()
      )?._id
      const overrunCount = await UnplannedStop.countDocuments({
        workCenterId: new Types.ObjectId(wcId),
        reasonId: { $ne: microStopId },
      })
      expect(overrunCount).toBe(0)
    })
  })

  describe('update (template immutable parts)', () => {
    it('updates name and overrunPolicy', async () => {
      const tpl = await createTemplate()
      const updated = await service.update(
        tpl._id.toString(),
        { name: 'Lunch', overrunPolicy: 'alert_only' },
        userId,
      )
      expect(updated.name).toBe('Lunch')
      expect(updated.overrunPolicy).toBe('alert_only')
    })

    it('remove deletes the template', async () => {
      const tpl = await createTemplate()
      await service.remove(tpl._id.toString())
      const after = await PlannedStopTemplate.findById(tpl._id)
      expect(after).toBeNull()
    })
  })
})
