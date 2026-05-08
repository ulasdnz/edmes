import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheDel, cacheWrap, cacheWrapDedup } = vi.hoisted(() => ({
  cacheDel: vi.fn(async () => {}),
  cacheWrap: vi.fn(async (_k: string, _t: number, loader: () => Promise<unknown>) => loader()),
  cacheWrapDedup: vi.fn(async (_k: string, _t: number, loader: () => Promise<unknown>) => loader()),
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
  getLatest: vi.fn(async () => null),
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
import { bootstrapSystemReasons } from '../reason/reason.bootstrap.js'
import { Reason } from '../reason/reason.model.js'
import { PlannedStopSchedule } from './planned-stop-schedule.model.js'
import {
  __test__,
  onScheduleCreated,
  onScheduleDeleted,
  startPlannedStopScheduler,
  stopPlannedStopScheduler,
} from './planned-stop-schedule.scheduler.js'

const userId = new Types.ObjectId().toString()

async function seedScheduledReason() {
  return Reason.create({
    code: `R-${new Types.ObjectId().toString()}`,
    name: 'Break',
    usages: ['planned_stop'],
    canStartManually: true,
    canBeScheduled: true,
    canConvertFromUnplanned: false,
    isSystemDefault: false,
    isActive: true,
    affectsOee: false,
    createdBy: new Types.ObjectId(userId),
  })
}

async function createSchedule(
  overrides: Partial<{
    workCenterIds: string[]
    occurrenceStartMode: 'automatic' | 'manual'
    plannedDurationMs: number
    recurrence: Record<string, unknown>
    isEnabled: boolean
  }> = {},
) {
  const reason = await seedScheduledReason()
  const now = new Date()
  return PlannedStopSchedule.create({
    workCenterIds: (overrides.workCenterIds ?? [new Types.ObjectId().toString()]).map(
      id => new Types.ObjectId(id),
    ),
    reasonId: reason._id,
    plannedOwnerId: new Types.ObjectId(userId),
    name: 'Test schedule',
    occurrenceStartMode: overrides.occurrenceStartMode ?? 'manual',
    recurrence: overrides.recurrence ?? {
      frequency: 'daily',
      timezone: 'Europe/Istanbul',
      startHour: (now.getUTCHours() + 5) % 24,
      startMinute: 0,
    },
    plannedDurationMs: overrides.plannedDurationMs ?? 30 * 60 * 1000,
    createBeforeStartMs: 60 * 1000,
    isEnabled: overrides.isEnabled ?? true,
    createdBy: new Types.ObjectId(userId),
  })
}

describe('planned-stop-schedule.scheduler', () => {
  beforeEach(async () => {
    await bootstrapSystemReasons()
    __test__.timers.clear()
  })

  afterEach(async () => {
    await stopPlannedStopScheduler()
  })

  describe('materialize idempotency', () => {
    it('creates one planned stop per workCenter and swallows duplicate-key on retry', async () => {
      const wcA = new Types.ObjectId().toString()
      const wcB = new Types.ObjectId().toString()
      const schedule = await createSchedule({
        workCenterIds: [wcA, wcB],
        occurrenceStartMode: 'manual',
      })
      const plannedStartAt = new Date('2026-06-20T10:00:00.000Z')
      const plannedEndAt = new Date('2026-06-20T10:30:00.000Z')

      await __test__.materialize(
        schedule.toObject() as Parameters<typeof __test__.materialize>[0],
        plannedStartAt,
        plannedEndAt,
      )
      await __test__.materialize(
        schedule.toObject() as Parameters<typeof __test__.materialize>[0],
        plannedStartAt,
        plannedEndAt,
      )

      const count = await PlannedStop.countDocuments({ scheduleId: schedule._id })
      expect(count).toBe(2)
    })
  })

  describe('automatic late run', () => {
    it('auto-starts the freshly materialized planned stop when plannedStartAt <= now', async () => {
      const wcId = new Types.ObjectId().toString()
      const schedule = await createSchedule({
        workCenterIds: [wcId],
        occurrenceStartMode: 'automatic',
      })

      const plannedStartAt = new Date(Date.now() - 60_000)
      const plannedEndAt = new Date(plannedStartAt.getTime() + 30 * 60 * 1000)

      await __test__.materialize(
        schedule.toObject() as Parameters<typeof __test__.materialize>[0],
        plannedStartAt,
        plannedEndAt,
      )

      const doc = await PlannedStop.findOne({
        scheduleId: schedule._id,
        workCenterId: new Types.ObjectId(wcId),
      }).lean()
      expect(doc).not.toBeNull()
      expect(doc?.status).toBe('active')
      expect(doc?.actualStartAt).not.toBeNull()
    })

    it('manual mode: stays in planned, does NOT auto-start even when start time has passed', async () => {
      const wcId = new Types.ObjectId().toString()
      const schedule = await createSchedule({
        workCenterIds: [wcId],
        occurrenceStartMode: 'manual',
      })

      const plannedStartAt = new Date(Date.now() - 60_000)
      const plannedEndAt = new Date(plannedStartAt.getTime() + 30 * 60 * 1000)
      await __test__.materialize(
        schedule.toObject() as Parameters<typeof __test__.materialize>[0],
        plannedStartAt,
        plannedEndAt,
      )
      const doc = await PlannedStop.findOne({ scheduleId: schedule._id }).lean()
      expect(doc?.status).toBe('planned')
    })
  })

  describe('timer lifecycle', () => {
    it('onScheduleCreated registers a timer when running', async () => {
      await startPlannedStopScheduler()
      const schedule = await createSchedule()
      onScheduleCreated(schedule.toObject() as Parameters<typeof onScheduleCreated>[0])
      expect(__test__.timers.has(schedule._id.toString())).toBe(true)
    })

    it('onScheduleDeleted clears the timer', async () => {
      await startPlannedStopScheduler()
      const schedule = await createSchedule()
      onScheduleCreated(schedule.toObject() as Parameters<typeof onScheduleCreated>[0])
      onScheduleDeleted(schedule._id.toString())
      expect(__test__.timers.has(schedule._id.toString())).toBe(false)
    })

    it('disabled schedule does not register a timer', async () => {
      await startPlannedStopScheduler()
      const schedule = await createSchedule({ isEnabled: false })
      onScheduleCreated(schedule.toObject() as Parameters<typeof onScheduleCreated>[0])
      expect(__test__.timers.has(schedule._id.toString())).toBe(false)
    })
  })
})
