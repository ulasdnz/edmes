import type { DayOfWeek, IPlannedStopSchedule } from './planned-stop-schedule.model.js'

const DAY_ORDER: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

export interface Occurrence {
  plannedStartAt: Date
  plannedEndAt: Date
}

function wallClockOffsetMs(timezone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(instant)
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return asUtc - instant.getTime()
}

function zonedWallClockToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offset1 = wallClockOffsetMs(timezone, new Date(guess))
  const candidate = new Date(guess - offset1)
  const offset2 = wallClockOffsetMs(timezone, candidate)
  if (offset1 === offset2) return candidate
  return new Date(guess - offset2)
}

function zonedDateParts(
  timezone: string,
  instant: Date,
): { year: number; month: number; day: number; weekday: DayOfWeek } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dtf.formatToParts(instant)
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  const weekdayName = map.weekday.toLowerCase() as DayOfWeek
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekdayName,
  }
}

export function nextOccurrenceAfter(
  schedule: Pick<IPlannedStopSchedule, 'recurrence' | 'plannedDurationMs'>,
  now: Date,
): Occurrence | null {
  const { recurrence, plannedDurationMs } = schedule
  const { frequency, timezone, startHour, startMinute, daysOfWeek } = recurrence

  const cursorStart = zonedDateParts(timezone, now)
  const LOOKAHEAD_DAYS = 370

  const isAllowedWeekday = (w: DayOfWeek): boolean => {
    if (!daysOfWeek || daysOfWeek.length === 0) return true
    return daysOfWeek.includes(w)
  }

  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset += 1) {
    const probeUtc = new Date(
      Date.UTC(cursorStart.year, cursorStart.month - 1, cursorStart.day) + offset * 86400_000,
    )
    const probe = zonedDateParts(timezone, probeUtc)
    const candidateStart = zonedWallClockToUtc(
      timezone,
      probe.year,
      probe.month,
      probe.day,
      startHour,
      startMinute,
    )
    if (candidateStart.getTime() <= now.getTime()) continue

    if (frequency === 'weekly' && !isAllowedWeekday(probe.weekday)) continue
    if (frequency === 'daily') {
      if (daysOfWeek && daysOfWeek.length > 0 && !isAllowedWeekday(probe.weekday)) continue
    }
    if (frequency === 'monthly') {
      if (probe.day !== cursorStart.day) continue
    }

    return {
      plannedStartAt: candidateStart,
      plannedEndAt: new Date(candidateStart.getTime() + plannedDurationMs),
    }
  }

  return null
}

// Exposed for testing.
export const __test__ = { zonedDateParts, zonedWallClockToUtc, DAY_ORDER }
