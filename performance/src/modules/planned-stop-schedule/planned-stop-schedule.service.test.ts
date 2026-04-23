import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { Reason } from '../reason/reason.model.js'
import { PlannedStopSchedule } from './planned-stop-schedule.model.js'
import * as service from './planned-stop-schedule.service.js'

const userId = new Types.ObjectId().toString()

async function seedScheduledReason(
  overrides: Partial<{
    canBeScheduled: boolean
    isActive: boolean
    usages: string[]
  }> = {},
) {
  return Reason.create({
    code: `R-${new Types.ObjectId().toString()}`,
    name: 'Lunch',
    usages: overrides.usages ?? ['planned_stop'],
    canStartManually: false,
    canBeScheduled: overrides.canBeScheduled ?? true,
    canConvertFromUnplanned: false,
    isSystemDefault: false,
    isActive: overrides.isActive ?? true,
    affectsOee: false,
    createdBy: new Types.ObjectId(userId),
  })
}

function baseCreateInput(reasonId: string): Parameters<typeof service.create>[0] {
  return {
    reasonId,
    plannedOwnerId: new Types.ObjectId().toString(),
    name: 'Daily lunch',
    occurrenceStartMode: 'automatic',
    recurrence: {
      frequency: 'daily',
      timezone: 'Europe/Istanbul',
      startHour: 12,
      startMinute: 0,
    },
    plannedDurationMs: 30 * 60 * 1000,
  }
}

describe('PlannedStopScheduleService', () => {
  describe('create', () => {
    it('creates a daily schedule', async () => {
      const reason = await seedScheduledReason()
      const doc = await service.create(baseCreateInput(reason._id.toString()), userId)
      expect(doc.name).toBe('Daily lunch')
      expect(doc.recurrence.frequency).toBe('daily')
      expect(doc.isEnabled).toBe(true)
    })

    it('rejects reason without canBeScheduled', async () => {
      const reason = await seedScheduledReason({ canBeScheduled: false })
      await expect(
        service.create(baseCreateInput(reason._id.toString()), userId),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.reason_cannot_be_scheduled',
      })
    })

    it('rejects inactive reason', async () => {
      const reason = await seedScheduledReason({ isActive: false })
      await expect(
        service.create(baseCreateInput(reason._id.toString()), userId),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.reason_inactive',
      })
    })

    it('rejects reason with wrong usage', async () => {
      const reason = await seedScheduledReason({ usages: ['unplanned_stop'] })
      await expect(
        service.create(baseCreateInput(reason._id.toString()), userId),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.reason_usage_mismatch',
      })
    })

    it('rejects invalid timezone', async () => {
      const reason = await seedScheduledReason()
      const input = baseCreateInput(reason._id.toString())
      input.recurrence.timezone = 'Not/AZone'
      await expect(service.create(input, userId)).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.schedule_invalid_timezone',
      })
    })

    it('rejects weekly without daysOfWeek', async () => {
      const reason = await seedScheduledReason()
      const input = baseCreateInput(reason._id.toString())
      input.recurrence = {
        frequency: 'weekly',
        timezone: 'Europe/Istanbul',
        startHour: 10,
        startMinute: 0,
      }
      await expect(service.create(input, userId)).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.schedule_weekly_requires_days',
      })
    })

    it('rejects invalid duration', async () => {
      const reason = await seedScheduledReason()
      const input = baseCreateInput(reason._id.toString())
      input.plannedDurationMs = 0
      await expect(service.create(input, userId)).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.schedule_invalid_duration',
      })
    })
  })

  describe('update', () => {
    it('updates recurrence and duration', async () => {
      const reason = await seedScheduledReason()
      const doc = await service.create(baseCreateInput(reason._id.toString()), userId)
      const updated = await service.update(
        doc._id.toString(),
        {
          plannedDurationMs: 60 * 60 * 1000,
          recurrence: {
            frequency: 'weekly',
            timezone: 'Europe/Istanbul',
            startHour: 8,
            startMinute: 0,
            daysOfWeek: ['monday'],
          },
        },
        userId,
      )
      expect(updated.plannedDurationMs).toBe(60 * 60 * 1000)
      expect(updated.recurrence.frequency).toBe('weekly')
      expect(updated.recurrence.daysOfWeek).toEqual(['monday'])
    })

    it('404 on non-existent', async () => {
      await expect(
        service.update(new Types.ObjectId().toString(), { name: 'x' }, userId),
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('remove', () => {
    it('deletes schedule', async () => {
      const reason = await seedScheduledReason()
      const doc = await service.create(baseCreateInput(reason._id.toString()), userId)
      await service.remove(doc._id.toString())
      const after = await PlannedStopSchedule.findById(doc._id)
      expect(after).toBeNull()
    })

    it('404 when nothing to remove', async () => {
      await expect(service.remove(new Types.ObjectId().toString())).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('list / listEnabled', () => {
    it('lists only enabled schedules via listEnabled', async () => {
      const reason = await seedScheduledReason()
      const a = await service.create(baseCreateInput(reason._id.toString()), userId)
      const b = await service.create(
        { ...baseCreateInput(reason._id.toString()), name: 'Disabled', isEnabled: false },
        userId,
      )
      const enabled = await service.listEnabled()
      const ids = enabled.map(d => d._id.toString())
      expect(ids).toContain(a._id.toString())
      expect(ids).not.toContain(b._id.toString())
    })

    it('filters list by workCenterId and reasonId', async () => {
      const reason = await seedScheduledReason()
      const wcId = new Types.ObjectId().toString()
      const doc = await service.create(
        { ...baseCreateInput(reason._id.toString()), workCenterIds: [wcId] },
        userId,
      )
      const byWc = await service.list({ workCenterId: wcId })
      expect(byWc.map(d => d._id.toString())).toContain(doc._id.toString())
      const byReason = await service.list({ reasonId: reason._id.toString() })
      expect(byReason.map(d => d._id.toString())).toContain(doc._id.toString())
    })
  })
})
