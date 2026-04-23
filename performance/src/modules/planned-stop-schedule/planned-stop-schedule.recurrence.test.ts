import { describe, expect, it } from 'vitest'
import type { IPlannedStopSchedule } from './planned-stop-schedule.model.js'
import { nextOccurrenceAfter } from './planned-stop-schedule.recurrence.js'

type ScheduleInput = Pick<IPlannedStopSchedule, 'recurrence' | 'plannedDurationMs'>

const ONE_HOUR = 60 * 60 * 1000

describe('planned-stop-schedule.recurrence', () => {
  describe('daily', () => {
    it('returns today if the daily time is still ahead', () => {
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'daily',
          timezone: 'Europe/Istanbul',
          startHour: 14,
          startMinute: 30,
        },
        plannedDurationMs: 15 * 60 * 1000,
      }
      // 2026-06-15 08:00:00 Europe/Istanbul (UTC+3) -> 05:00 UTC
      const now = new Date('2026-06-15T05:00:00.000Z')
      const occ = nextOccurrenceAfter(schedule, now)
      expect(occ).not.toBeNull()
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-06-15T11:30:00.000Z')
      expect(occ?.plannedEndAt.getTime() - occ?.plannedStartAt.getTime()).toBe(15 * 60 * 1000)
    })

    it('returns tomorrow when today has already passed', () => {
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'daily',
          timezone: 'Europe/Istanbul',
          startHour: 9,
          startMinute: 0,
        },
        plannedDurationMs: ONE_HOUR,
      }
      // 2026-06-15 18:00 Istanbul (UTC+3) -> 15:00 UTC, 09:00 already passed
      const now = new Date('2026-06-15T15:00:00.000Z')
      const occ = nextOccurrenceAfter(schedule, now)
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-06-16T06:00:00.000Z')
    })

    it('skips daysOfWeek that are not allowed in daily mode', () => {
      // Only tuesdays allowed; 2026-06-15 is Monday.
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'daily',
          timezone: 'Europe/Istanbul',
          startHour: 10,
          startMinute: 0,
          daysOfWeek: ['tuesday'],
        },
        plannedDurationMs: ONE_HOUR,
      }
      const now = new Date('2026-06-15T03:00:00.000Z') // Mon 06:00 Istanbul
      const occ = nextOccurrenceAfter(schedule, now)
      // Next Tuesday 2026-06-16 10:00 Istanbul -> 07:00 UTC
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-06-16T07:00:00.000Z')
    })
  })

  describe('weekly', () => {
    it('returns the next allowed weekday', () => {
      // Allowed: wednesday + friday; 2026-06-15 is Monday.
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'weekly',
          timezone: 'Europe/Istanbul',
          startHour: 14,
          startMinute: 0,
          daysOfWeek: ['wednesday', 'friday'],
        },
        plannedDurationMs: ONE_HOUR,
      }
      const now = new Date('2026-06-15T07:00:00.000Z') // Mon 10:00 Istanbul
      const occ = nextOccurrenceAfter(schedule, now)
      // Next Wed 2026-06-17 14:00 Istanbul -> 11:00 UTC
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-06-17T11:00:00.000Z')
    })

    it('wraps to next week when only weekday allowed is same day but passed', () => {
      // Only monday allowed; now is Monday late.
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'weekly',
          timezone: 'Europe/Istanbul',
          startHour: 8,
          startMinute: 0,
          daysOfWeek: ['monday'],
        },
        plannedDurationMs: ONE_HOUR,
      }
      const now = new Date('2026-06-15T12:00:00.000Z') // Mon 15:00 Istanbul, 08:00 passed
      const occ = nextOccurrenceAfter(schedule, now)
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-06-22T05:00:00.000Z')
    })
  })

  describe('monthly', () => {
    it('returns same day next month when day already passed this month', () => {
      // now = 2026-06-15 20:00 Istanbul, monthly 10:00 on day-15
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'monthly',
          timezone: 'Europe/Istanbul',
          startHour: 10,
          startMinute: 0,
        },
        plannedDurationMs: ONE_HOUR,
      }
      const now = new Date('2026-06-15T17:00:00.000Z')
      const occ = nextOccurrenceAfter(schedule, now)
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-07-15T07:00:00.000Z')
    })

    it('returns today if the time is still ahead (monthly)', () => {
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'monthly',
          timezone: 'Europe/Istanbul',
          startHour: 23,
          startMinute: 30,
        },
        plannedDurationMs: ONE_HOUR,
      }
      const now = new Date('2026-06-15T05:00:00.000Z') // 08:00 Istanbul
      const occ = nextOccurrenceAfter(schedule, now)
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-06-15T20:30:00.000Z')
    })
  })

  describe('DST handling', () => {
    it('handles Europe/Berlin spring-forward correctly', () => {
      // 2026-03-29 02:00 Berlin does not exist (skips to 03:00); DST 02:30 fallback.
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'daily',
          timezone: 'Europe/Berlin',
          startHour: 10,
          startMinute: 0,
        },
        plannedDurationMs: ONE_HOUR,
      }
      // now = 2026-03-29 06:00 UTC (= 08:00 Berlin DST)
      const now = new Date('2026-03-29T06:00:00.000Z')
      const occ = nextOccurrenceAfter(schedule, now)
      // 10:00 CEST = 08:00 UTC
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-03-29T08:00:00.000Z')
    })

    it('handles Europe/Berlin fall-back correctly', () => {
      // 2026-10-25 03:00 Berlin clocks roll back to 02:00; 10:00 stays 10:00 CET = 09:00 UTC.
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'daily',
          timezone: 'Europe/Berlin',
          startHour: 10,
          startMinute: 0,
        },
        plannedDurationMs: ONE_HOUR,
      }
      const now = new Date('2026-10-25T06:00:00.000Z') // 07:00 CET
      const occ = nextOccurrenceAfter(schedule, now)
      expect(occ?.plannedStartAt.toISOString()).toBe('2026-10-25T09:00:00.000Z')
    })
  })

  describe('no occurrence', () => {
    it('still finds an occurrence within the lookahead window', () => {
      const schedule: ScheduleInput = {
        recurrence: {
          frequency: 'weekly',
          timezone: 'Europe/Istanbul',
          startHour: 10,
          startMinute: 0,
          daysOfWeek: ['saturday'],
        },
        plannedDurationMs: ONE_HOUR,
      }
      const now = new Date('2026-06-15T00:00:00.000Z')
      const occ = nextOccurrenceAfter(schedule, now)
      expect(occ).not.toBeNull()
    })
  })
})
