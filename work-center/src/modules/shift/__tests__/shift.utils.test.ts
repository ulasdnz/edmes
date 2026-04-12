import { describe, expect, it } from 'vitest'
import {
  assertNoOverlap,
  computeOccurrenceDay,
  currentRunningOccurrence,
  endBoundariesBetween,
  isShiftCurrentlyRunning,
  nextStartAfter,
  occurrenceEndOnDay,
  shiftsOverlap,
  shiftToMinutes,
} from '../shift.utils.js'

type Shift = {
  _id: string
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}

const mk = (id: string, sh: number, sm: number, eh: number, em: number): Shift => ({
  _id: id,
  startHour: sh,
  startMinute: sm,
  endHour: eh,
  endMinute: em,
})

describe('shiftToMinutes', () => {
  it('normalizes end 00:00 to 1440 (end-of-day)', () => {
    expect(shiftToMinutes(mk('a', 16, 0, 0, 0))).toEqual({ start: 960, end: 1440 })
  })
  it('keeps same-day interval', () => {
    expect(shiftToMinutes(mk('a', 8, 0, 16, 0))).toEqual({ start: 480, end: 960 })
  })
  it('keeps overnight interval as start > end', () => {
    expect(shiftToMinutes(mk('a', 22, 0, 6, 0))).toEqual({ start: 1320, end: 360 })
  })
})

describe('shiftsOverlap', () => {
  it('returns false for disjoint same-day shifts', () => {
    expect(shiftsOverlap(mk('a', 8, 0, 16, 0), mk('b', 16, 0, 22, 0))).toBe(false)
  })
  it('returns true for overlapping same-day shifts', () => {
    expect(shiftsOverlap(mk('a', 8, 0, 16, 0), mk('b', 10, 0, 18, 0))).toBe(true)
  })
  it('treats 16:00-00:00 as same-day (no overnight)', () => {
    expect(shiftsOverlap(mk('a', 16, 0, 0, 0), mk('b', 8, 0, 16, 0))).toBe(false)
    expect(shiftsOverlap(mk('a', 16, 0, 0, 0), mk('b', 0, 0, 8, 0))).toBe(false)
  })
  it('detects overlap between day and overnight shift', () => {
    expect(shiftsOverlap(mk('a', 22, 0, 6, 0), mk('b', 5, 0, 8, 0))).toBe(true)
  })
  it('detects overlap between two overnight shifts across midnight', () => {
    expect(shiftsOverlap(mk('a', 22, 0, 6, 0), mk('b', 23, 0, 5, 0))).toBe(true)
  })
  it('returns false for adjacent shifts meeting at boundary', () => {
    expect(shiftsOverlap(mk('a', 8, 0, 16, 0), mk('b', 16, 0, 0, 0))).toBe(false)
  })
})

describe('assertNoOverlap', () => {
  it('throws on overlap', () => {
    const shifts = [mk('a', 8, 0, 16, 0), mk('b', 15, 0, 22, 0)]
    expect(() => assertNoOverlap(shifts)).toThrow()
  })
  it('throws on duplicate ids', () => {
    const shifts = [mk('a', 8, 0, 16, 0), mk('a', 16, 0, 22, 0)]
    expect(() => assertNoOverlap(shifts)).toThrow(/duplicate/i)
  })
  it('passes for disjoint set', () => {
    expect(() =>
      assertNoOverlap([mk('a', 6, 0, 14, 0), mk('b', 14, 0, 22, 0), mk('c', 22, 0, 6, 0)]),
    ).not.toThrow()
  })
})

describe('computeOccurrenceDay', () => {
  it('returns local date of the start instant in the given timezone', () => {
    const startedAt = new Date('2026-03-10T21:00:00.000Z')
    expect(computeOccurrenceDay(startedAt, 'Europe/Istanbul')).toBe('2026-03-11')
  })
  it('handles UTC timezone', () => {
    expect(computeOccurrenceDay(new Date('2026-03-10T05:00:00.000Z'), 'UTC')).toBe('2026-03-10')
  })
})

describe('nextStartAfter', () => {
  it('returns today start when now is before today start', () => {
    const now = new Date('2026-03-10T02:00:00.000Z')
    const out = nextStartAfter(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')
    expect(out.startedAt.toISOString()).toBe('2026-03-10T05:00:00.000Z')
    expect(out.occurrenceDay).toBe('2026-03-10')
  })
  it('returns tomorrow start when now is after today start (already running)', () => {
    const now = new Date('2026-03-10T09:00:00.000Z')
    const out = nextStartAfter(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')
    expect(out.startedAt.toISOString()).toBe('2026-03-11T05:00:00.000Z')
    expect(out.occurrenceDay).toBe('2026-03-11')
  })
  it('returns tonight start for overnight shift when now is before tonight start', () => {
    const now = new Date('2026-03-10T15:00:00.000Z')
    const out = nextStartAfter(mk('a', 22, 0, 6, 0), now, 'Europe/Istanbul')
    expect(out.startedAt.toISOString()).toBe('2026-03-10T19:00:00.000Z')
    expect(out.occurrenceDay).toBe('2026-03-10')
  })
})

describe('currentRunningOccurrence', () => {
  it('returns the current occurrence when now is mid-shift (same-day)', () => {
    const now = new Date('2026-03-10T09:00:00.000Z')
    const out = currentRunningOccurrence(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')
    expect(out).not.toBeNull()
    expect(out!.startedAt.toISOString()).toBe('2026-03-10T05:00:00.000Z')
    expect(out!.endedAt.toISOString()).toBe('2026-03-10T13:00:00.000Z')
    expect(out!.occurrenceDay).toBe('2026-03-10')
  })
  it('returns null when not currently running (after end)', () => {
    const now = new Date('2026-03-10T14:00:00.000Z')
    expect(currentRunningOccurrence(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')).toBeNull()
  })
  it('returns null when not currently running (before start)', () => {
    const now = new Date('2026-03-10T02:00:00.000Z')
    expect(currentRunningOccurrence(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')).toBeNull()
  })
  it('returns the previous-day occurrence for an overnight shift mid-run after midnight', () => {
    const now = new Date('2026-03-10T23:00:00.000Z')
    const out = currentRunningOccurrence(mk('a', 22, 0, 6, 0), now, 'Europe/Istanbul')
    expect(out).not.toBeNull()
    expect(out!.occurrenceDay).toBe('2026-03-10')
    expect(out!.startedAt.toISOString()).toBe('2026-03-10T19:00:00.000Z')
    expect(out!.endedAt.toISOString()).toBe('2026-03-11T03:00:00.000Z')
  })
  it('returns the today occurrence for an overnight shift after start before midnight', () => {
    const now = new Date('2026-03-10T20:00:00.000Z')
    const out = currentRunningOccurrence(mk('a', 22, 0, 6, 0), now, 'Europe/Istanbul')
    expect(out!.occurrenceDay).toBe('2026-03-10')
  })
})

describe('endBoundariesBetween', () => {
  it('returns end boundaries that fall in (from, to] for a same-day shift', () => {
    const from = new Date('2026-03-10T05:00:00.000Z')
    const to = new Date('2026-03-12T17:00:00.000Z')
    const out = endBoundariesBetween(mk('a', 8, 0, 16, 0), from, to, 'Europe/Istanbul')
    expect(out.map(o => o.endedAt.toISOString())).toEqual([
      '2026-03-10T13:00:00.000Z',
      '2026-03-11T13:00:00.000Z',
      '2026-03-12T13:00:00.000Z',
    ])
    expect(out.map(o => o.occurrenceDay)).toEqual(['2026-03-10', '2026-03-11', '2026-03-12'])
  })
  it('excludes a boundary equal to from (open-left)', () => {
    const from = new Date('2026-03-10T13:00:00.000Z')
    const to = new Date('2026-03-11T13:00:00.000Z')
    const out = endBoundariesBetween(mk('a', 8, 0, 16, 0), from, to, 'Europe/Istanbul')
    expect(out.map(o => o.endedAt.toISOString())).toEqual(['2026-03-11T13:00:00.000Z'])
  })
  it('handles overnight shift (end on the next calendar day)', () => {
    const from = new Date('2026-03-10T19:00:00.000Z')
    const to = new Date('2026-03-11T05:00:00.000Z')
    const out = endBoundariesBetween(mk('a', 22, 0, 6, 0), from, to, 'Europe/Istanbul')
    expect(out.length).toBe(1)
    expect(out[0]!.endedAt.toISOString()).toBe('2026-03-11T03:00:00.000Z')
    expect(out[0]!.occurrenceDay).toBe('2026-03-10')
  })
  it('returns empty when no end boundary falls inside the range', () => {
    const from = new Date('2026-03-10T05:00:00.000Z')
    const to = new Date('2026-03-10T10:00:00.000Z')
    const out = endBoundariesBetween(mk('a', 8, 0, 16, 0), from, to, 'Europe/Istanbul')
    expect(out).toEqual([])
  })
})

describe('occurrenceEndOnDay', () => {
  it('returns the same-day end for a day shift', () => {
    expect(
      occurrenceEndOnDay(mk('a', 8, 0, 16, 0), '2026-03-10', 'Europe/Istanbul').toISOString(),
    ).toBe('2026-03-10T13:00:00.000Z')
  })
  it('returns the next-day end for an overnight shift', () => {
    expect(
      occurrenceEndOnDay(mk('a', 22, 0, 6, 0), '2026-03-10', 'Europe/Istanbul').toISOString(),
    ).toBe('2026-03-11T03:00:00.000Z')
  })
  it('treats end 00:00 as end-of-day (1440)', () => {
    expect(
      occurrenceEndOnDay(mk('a', 16, 0, 0, 0), '2026-03-10', 'Europe/Istanbul').toISOString(),
    ).toBe('2026-03-10T21:00:00.000Z')
  })
})

describe('isShiftCurrentlyRunning', () => {
  it('is a thin wrapper over currentRunningOccurrence', () => {
    const inside = new Date('2026-03-10T09:00:00.000Z')
    const outside = new Date('2026-03-10T14:00:00.000Z')
    expect(isShiftCurrentlyRunning(mk('a', 8, 0, 16, 0), inside, 'Europe/Istanbul')).toBe(true)
    expect(isShiftCurrentlyRunning(mk('a', 8, 0, 16, 0), outside, 'Europe/Istanbul')).toBe(false)
  })
})
