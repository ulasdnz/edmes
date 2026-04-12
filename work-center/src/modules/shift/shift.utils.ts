import { CustomError } from '../../core/errors/index.js'

export type ShiftLike = {
  _id: string | { toString(): string }
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}

export function shiftToMinutes(shift: ShiftLike): { start: number; end: number } {
  const start = shift.startHour * 60 + shift.startMinute
  let end = shift.endHour * 60 + shift.endMinute
  if (end === 0) end = 1440
  return { start, end }
}

function expandOvernight(start: number, end: number): Array<[number, number]> {
  if (start < end) return [[start, end]]
  return [
    [start, 1440],
    [0, end],
  ]
}

export function shiftsOverlap(a: ShiftLike, b: ShiftLike): boolean {
  const am = shiftToMinutes(a)
  const bm = shiftToMinutes(b)
  if (am.start === am.end || bm.start === bm.end) {
    throw new CustomError(400, 'shift.invalid_time_range')
  }
  const aSegments = expandOvernight(am.start, am.end)
  const bSegments = expandOvernight(bm.start, bm.end)
  for (const [aS, aE] of aSegments) {
    for (const [bS, bE] of bSegments) {
      if (aS < bE && bS < aE) return true
    }
  }
  return false
}

export function assertNoOverlap(shifts: ShiftLike[]): void {
  const seen = new Set<string>()
  for (const s of shifts) {
    const id = String(s._id)
    if (seen.has(id)) {
      throw new CustomError(400, 'shift.duplicate_in_assignment', { shiftId: id })
    }
    seen.add(id)
  }
  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      if (shiftsOverlap(shifts[i]!, shifts[j]!)) {
        throw new CustomError(400, 'shift.overlap_in_assignment', {
          shiftIds: [String(shifts[i]!._id), String(shifts[j]!._id)],
        })
      }
    }
  }
}

export function computeOccurrenceDay(instant: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(instant)
}

export function nextStartAfter(
  shift: ShiftLike,
  now: Date,
  timezone: string,
): { startedAt: Date; occurrenceDay: string } {
  const { start: startMin } = shiftToMinutes(shift)
  const today = computeOccurrenceDay(now, timezone)
  const todayStart = plantLocalToUtc(today, startMin, timezone)
  if (todayStart.getTime() > now.getTime()) {
    return { startedAt: todayStart, occurrenceDay: today }
  }
  const tomorrow = addDays(today, 1)
  return {
    startedAt: plantLocalToUtc(tomorrow, startMin, timezone),
    occurrenceDay: tomorrow,
  }
}

export function currentRunningOccurrence(
  shift: ShiftLike,
  now: Date,
  timezone: string,
): { startedAt: Date; endedAt: Date; occurrenceDay: string } | null {
  const { start: startMin, end: endMin } = shiftToMinutes(shift)
  const overnight = startMin > endMin
  const today = computeOccurrenceDay(now, timezone)
  const candidateDays = overnight ? [addDays(today, -1), today] : [today]
  for (const day of candidateDays) {
    const startedAt = plantLocalToUtc(day, startMin, timezone)
    const endedAt = overnight
      ? plantLocalToUtc(addDays(day, 1), endMin, timezone)
      : plantLocalToUtc(day, endMin, timezone)
    if (now.getTime() >= startedAt.getTime() && now.getTime() < endedAt.getTime()) {
      return { startedAt, endedAt, occurrenceDay: day }
    }
  }
  return null
}

export function occurrenceEndOnDay(
  shift: ShiftLike,
  occurrenceDay: string,
  timezone: string,
): Date {
  const { start: startMin, end: endMin } = shiftToMinutes(shift)
  const overnight = startMin > endMin
  return overnight
    ? plantLocalToUtc(addDays(occurrenceDay, 1), endMin, timezone)
    : plantLocalToUtc(occurrenceDay, endMin, timezone)
}

export function endBoundariesBetween(
  shift: ShiftLike,
  from: Date,
  to: Date,
  timezone: string,
): Array<{ startedAt: Date; endedAt: Date; occurrenceDay: string }> {
  if (to.getTime() <= from.getTime()) return []
  const { start: startMin, end: endMin } = shiftToMinutes(shift)
  const overnight = startMin > endMin
  const firstDay = computeOccurrenceDay(from, timezone)
  const lastDay = computeOccurrenceDay(to, timezone)
  let day = overnight ? addDays(firstDay, -1) : firstDay
  const out: Array<{ startedAt: Date; endedAt: Date; occurrenceDay: string }> = []
  while (true) {
    const startedAt = plantLocalToUtc(day, startMin, timezone)
    const endedAt = overnight
      ? plantLocalToUtc(addDays(day, 1), endMin, timezone)
      : plantLocalToUtc(day, endMin, timezone)
    if (startedAt.getTime() > to.getTime()) break
    if (endedAt.getTime() > from.getTime() && endedAt.getTime() <= to.getTime()) {
      out.push({ startedAt, endedAt, occurrenceDay: day })
    }
    if (day > lastDay) break
    day = addDays(day, 1)
  }
  return out
}

export function isShiftCurrentlyRunning(shift: ShiftLike, now: Date, timezone: string): boolean {
  return currentRunningOccurrence(shift, now, timezone) !== null
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function addDays(yyyyMmDd: string, delta: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number) as [number, number, number]
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + delta)
  const yy = base.getUTCFullYear()
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(base.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function plantLocalToUtc(yyyyMmDd: string, minuteOfDay: number, timezone: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number) as [number, number, number]
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  const naiveUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0, 0)
  const offsetMinutes = getTimezoneOffsetMinutes(timezone, new Date(naiveUtcMs))
  return new Date(naiveUtcMs - offsetMinutes * 60_000)
}

function getTimezoneOffsetMinutes(timezone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(at)
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return Math.round((asUtc - at.getTime()) / 60_000)
}
