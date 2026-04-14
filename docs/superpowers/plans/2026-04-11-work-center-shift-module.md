# Work-Center Shift Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global `shift` module inside `work-center` service that owns shift CRUD, runtime boundary scheduling, and triggers operator auto check-out on shift end — while refactoring schedule/calendar/exception to reference shifts instead of embedding them.

**Architecture:** Global shift catalog stored in MongoDB. A singleton in-process scheduler (`setTimeout`-based) manages per-shift `started`/`ended` timers, derived from `PLANT_TIMEZONE`. Boundary events publish a single `work_center.shift.started` / `work_center.shift.ended` — consumers resolve affected work centers from the **current** effective schedule at processing time (no start-time snapshot). Schedule mutations during a running shift are **allowed**; shift-ended consumer always re-resolves. Startup reconciliation scans open check-ins and closes stale ones based on current effective schedule. Shift delete/update is guarded by reference checks across `work-center`, `schedule`, `date-exception`, and `production` service (via internal API).

**Tech Stack:** TypeScript 5, Node 20, Express 5, Mongoose 9, Zod 4, Vitest 4 + `@testcontainers/mongodb`, Redis Streams via `@mes/events`.

---

## Key Design Decisions (from brainstorm + user follow-ups)

1. **Shift ownership** lives only in `work-center` service. `shiftId` in production is a non-opaque reference — production calls work-center internal API to validate.
2. **Global catalog with overlap enforced at assignment time**, not at shift create time. Two overlapping shifts `08-16` and `10-18` can both exist — they only conflict when assigned to the same work center / calendar day / exception.
3. **`00:00` end time = end-of-day (1440 minutes)** in overlap calculations.
4. **Effective schedule uniform response** shape regardless of source: `{ source, date, shiftIds, shifts }`. Closed day = `shiftIds: []` with source `exception`/`calendar`. No definition at all = `source: 'none'`.
5. **Boundary events are global** — not per-work-center. Consumers resolve affected work centers themselves.
6. **Scheduler is global** — not work-center-aware. Restart rebuilds timers from DB; no missed-event backfill.
7. **Schedule mutations during a running shift are allowed.** No active-shift guards on `WorkCenter.shiftIds` updates, calendar day edits, or exception edits. Shift-ended consumer always uses the effective schedule at processing time. No start-time snapshot is stored.
8. **Startup reconciliation** (despite no backfill): on boot, scan every open operator check-in. For each, walk the work center's effective schedule from `max(checkedInAt, now − 14d)` through today and find the EARLIEST missed shift-end boundary in `(scanFrom, now]`. If one exists → close at that boundary. Else if no shift is currently running → close at now. Else → leave alone. Uses current schedule state only, never replays historical events. Catches the night→day rollover case where a different shift is currently running but the operator's original shift ended during downtime.
9. **Scheduler avoids synthetic `started` events**. The scheduler uses two separate utilities: `currentRunningOccurrence` (for the running occurrence's end timer) and `nextStartAfter` (always strictly future). On mid-shift boot, only the current occurrence's end timer is set — no past `started` is emitted. The chained reschedule on each fired boundary keeps the loop going indefinitely.
10. **Shift time update has active-occurrence rules**: start boundary change applies next occurrence (no extra logic — `nextStartAfter` is always future); end boundary → future time reschedules today's timer; end boundary → past time returns 409, computed against `currentRunningOccurrence(existing).occurrenceDay`.
11. **`checkoutSource` field on `OperatorCheckIn`**: `manual` vs `shift_boundary`. Emitted in `work_center.operator.checked_out` payload.
12. **Date-only values** (`occurrenceDay`, `DateException.localDate`, effective-schedule request date) are `YYYY-MM-DD` strings. Instants are ISO 8601 UTC `Z`.

---

## Existing State (confirmed via code read)

- `WorkCenter.shiftIds: [ObjectId]` **already exists** — no migration on that field.
- `Calendar.weeklyPattern.day` currently holds `[embeddedShiftSchema]` (name + start/end hour/minute). **Needs refactor** to `[ObjectId]`.
- `DateException.intervals` currently holds `[embeddedShiftSchema]` and `localDate: Date`. **Needs refactor** to `shiftIds: [ObjectId]` + `localDate: string`.
- `OperatorCheckIn.shiftId: ObjectId` exists; **no `checkoutSource` field yet** — needs to be added.
- `OperatorCheckIn` already has a `autoCheckOutByShift(workCenterId)` helper — needs to be upgraded / replaced.
- `readSchedules` / `writeSchedules` permissions **already exist** in `@mes/privileges`.
- `production` already has `QuantityAdjustment.shiftId` and `ScrapEntry.shiftId` as `required: true`.
- `production` already exposes `/internal/v1/work-centers/:id/references` — same pattern will be used for shifts.
- `work-center/src/lib/internal-api.ts` currently only targets user-service via `INTERNAL_API_USER` — needs a `INTERNAL_API_PRODUCTION` sibling.
- No `Shift` model, no `shift` module, no shift scheduler — all new.

---

## File Structure

**New files:**

```
work-center/src/modules/shift/
  shift.model.ts           # Mongoose Shift schema (name, time, audit)
  shift.types.ts           # Type aliases
  shift.utils.ts           # Time normalization, overlap detection, occurrenceDay calc
  shift.validators.ts      # Zod schemas for CRUD + params
  shift.service.ts         # CRUD + guards (uniqueName, delete refs, update refs)
  shift.controller.ts      # Thin handlers
  shift.routes.ts          # Express routes
  shift.scheduler.ts       # In-process setTimeout boundary timers
  shift.reconciliation.ts  # Startup auto check-out sweep
  __tests__/
    shift.utils.test.ts
    shift.service.test.ts
    shift.scheduler.test.ts
    shift.reconciliation.test.ts
    shift.routes.test.ts
```

**Modified files:**

```
work-center/src/config/index.ts                                # + PLANT_TIMEZONE, + INTERNAL_API_PRODUCTION
work-center/.env.example                                       # + both env vars
work-center/src/core/loaders/mongoose.ts                       # import shift.model
work-center/src/core/loaders/express.ts                        # mount shift.routes + shift internal refs route
work-center/src/core/loaders/index.ts                          # init scheduler + run reconciliation
work-center/src/app.ts                                         # shutdown scheduler
work-center/src/jobs/events.ts                                 # + shift.{created,updated,deleted,started,ended}
                                                               # + checkoutSource on operator.checked_out
work-center/src/jobs/subscribers.ts                            # consume work_center.shift.ended
work-center/src/lib/internal-api.ts                            # + hasProductionShiftReferences
work-center/src/modules/schedule/schedule.model.ts             # weeklyPattern day → ObjectId[],
                                                               # DateException.shiftIds + localDate:string
work-center/src/modules/schedule/schedule.validators.ts        # remove embedded shift, use ObjectId[]
work-center/src/modules/schedule/schedule.service.ts           # uniform response; re-fetch shifts;
                                                               # overlap enforcement on assignment
work-center/src/modules/work-center/work-center.service.ts    # shiftIds update overlap enforcement
work-center/src/modules/work-center/work-center.validators.ts  # shiftIds schema
work-center/src/modules/operators/operators.model.ts           # + checkoutSource field
work-center/src/modules/operators/operators.service.ts         # autoCheckOutByShiftEnd(shiftId, day)
                                                               # idempotent, uses effective schedule
                                                               # writes checkoutSource
work-center/src/modules/operators/operators.controller.ts      # passes checkoutSource:'manual'
production/src/modules/internal/shift-references.routes.ts    # NEW — /internal/v1/shifts/:id/references
production/src/core/loaders/express.ts                         # mount shift-references route
production/src/lib/internal-api.ts                             # + validateShiftExists against work-center
production/src/modules/quantity-adjustment/quantity-adjustment.service.ts  # sync shift existence check
production/src/modules/scrap-entry/scrap-entry.service.ts      # sync shift existence check
production/src/config/index.ts                                 # + INTERNAL_API_WORK_CENTER
work-center-spec.md                                            # update prose
docs/production-service-spec.md                                # update prose
```

---

# Tasks

## Task 1: Add env config for PLANT_TIMEZONE and production internal URL

**Files:**
- Modify: `work-center/src/config/index.ts`
- Modify: `work-center/.env.example`
- Modify: `work-center/vitest.config.ts`

- [ ] **Step 1.1: Add PLANT_TIMEZONE and INTERNAL_API_PRODUCTION to the Zod schema**

Add these two fields to `envSchema` in `work-center/src/config/index.ts`, right after `INTERNAL_API_USER`:

```typescript
    INTERNAL_API_USER: z.string().trim().min(1, 'INTERNAL_API_USER must be provided').pipe(z.url()),
    INTERNAL_API_PRODUCTION: z
      .string()
      .trim()
      .min(1, 'INTERNAL_API_PRODUCTION must be provided')
      .pipe(z.url()),
    PLANT_TIMEZONE: z
      .string()
      .trim()
      .min(1, 'PLANT_TIMEZONE must be provided')
      .refine(
        val => {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: val })
            return true
          } catch {
            return false
          }
        },
        { message: 'PLANT_TIMEZONE must be a valid IANA timezone (e.g. Europe/Istanbul)' },
      ),
```

- [ ] **Step 1.2: Add both env vars to `.env.example`**

Append to `work-center/.env.example`:

```
INTERNAL_API_PRODUCTION=http://localhost:3002
PLANT_TIMEZONE=Europe/Istanbul
```

- [ ] **Step 1.3: Add both env vars to vitest test env**

In `work-center/vitest.config.ts` update the `env:` block:

```typescript
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'test_secret',
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_API_USER: 'http://localhost:3000',
      INTERNAL_API_PRODUCTION: 'http://localhost:3002',
      PLANT_TIMEZONE: 'Europe/Istanbul',
    },
```

- [ ] **Step 1.4: Run typecheck to verify the schema change compiles**

Run: `cd work-center && pnpm typecheck`
Expected: PASS

- [ ] **Step 1.5: Commit**

```bash
git add work-center/src/config/index.ts work-center/.env.example work-center/vitest.config.ts
git commit -m "feat(work-center): add PLANT_TIMEZONE and production internal url config"
```

---

## Task 2: Shift time utilities (pure functions, TDD)

**Files:**
- Create: `work-center/src/modules/shift/shift.utils.ts`
- Test: `work-center/src/modules/shift/__tests__/shift.utils.test.ts`

- [ ] **Step 2.1: Write failing tests for shift time utilities**

Create `work-center/src/modules/shift/__tests__/shift.utils.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  shiftToMinutes,
  shiftsOverlap,
  assertNoOverlap,
  computeOccurrenceDay,
  nextStartAfter,
  currentRunningOccurrence,
  endBoundariesBetween,
  occurrenceEndOnDay,
  isShiftCurrentlyRunning,
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
    // 22:00-06:00 overlaps 05:00-08:00 (at 05:00-06:00)
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
    // 2026-03-10T21:00:00Z = 2026-03-11 00:00 Europe/Istanbul
    const startedAt = new Date('2026-03-10T21:00:00.000Z')
    expect(computeOccurrenceDay(startedAt, 'Europe/Istanbul')).toBe('2026-03-11')
  })
  it('handles UTC timezone', () => {
    expect(computeOccurrenceDay(new Date('2026-03-10T05:00:00.000Z'), 'UTC')).toBe('2026-03-10')
  })
})

describe('nextStartAfter', () => {
  it('returns today start when now is before today start', () => {
    // Now = 2026-03-10 05:00 IST (02:00 UTC). Shift 08-16.
    const now = new Date('2026-03-10T02:00:00.000Z')
    const out = nextStartAfter(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')
    expect(out.startedAt.toISOString()).toBe('2026-03-10T05:00:00.000Z')
    expect(out.occurrenceDay).toBe('2026-03-10')
  })
  it('returns tomorrow start when now is after today start (already running)', () => {
    // Now = 2026-03-10 12:00 IST (09:00 UTC). Shift 08-16. Current occurrence already started → next is tomorrow 08:00.
    const now = new Date('2026-03-10T09:00:00.000Z')
    const out = nextStartAfter(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')
    expect(out.startedAt.toISOString()).toBe('2026-03-11T05:00:00.000Z')
    expect(out.occurrenceDay).toBe('2026-03-11')
  })
  it('returns tonight start for overnight shift when now is before tonight start', () => {
    // Now = 2026-03-10 18:00 IST. Shift 22-06 → today 22:00.
    const now = new Date('2026-03-10T15:00:00.000Z')
    const out = nextStartAfter(mk('a', 22, 0, 6, 0), now, 'Europe/Istanbul')
    expect(out.startedAt.toISOString()).toBe('2026-03-10T19:00:00.000Z')
    expect(out.occurrenceDay).toBe('2026-03-10')
  })
})

describe('currentRunningOccurrence', () => {
  it('returns the current occurrence when now is mid-shift (same-day)', () => {
    // Now = 2026-03-10 12:00 IST (09:00 UTC). Shift 08-16.
    const now = new Date('2026-03-10T09:00:00.000Z')
    const out = currentRunningOccurrence(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')
    expect(out).not.toBeNull()
    expect(out!.startedAt.toISOString()).toBe('2026-03-10T05:00:00.000Z')
    expect(out!.endedAt.toISOString()).toBe('2026-03-10T13:00:00.000Z')
    expect(out!.occurrenceDay).toBe('2026-03-10')
  })
  it('returns null when not currently running (after end)', () => {
    const now = new Date('2026-03-10T14:00:00.000Z') // 17:00 IST
    expect(currentRunningOccurrence(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')).toBeNull()
  })
  it('returns null when not currently running (before start)', () => {
    const now = new Date('2026-03-10T02:00:00.000Z') // 05:00 IST
    expect(currentRunningOccurrence(mk('a', 8, 0, 16, 0), now, 'Europe/Istanbul')).toBeNull()
  })
  it('returns the previous-day occurrence for an overnight shift mid-run after midnight', () => {
    // Now = 2026-03-11 02:00 IST (2026-03-10 23:00 UTC). Shift 22-06 → occurrenceDay 2026-03-10.
    const now = new Date('2026-03-10T23:00:00.000Z')
    const out = currentRunningOccurrence(mk('a', 22, 0, 6, 0), now, 'Europe/Istanbul')
    expect(out).not.toBeNull()
    expect(out!.occurrenceDay).toBe('2026-03-10')
    expect(out!.startedAt.toISOString()).toBe('2026-03-10T19:00:00.000Z') // 22:00 IST
    expect(out!.endedAt.toISOString()).toBe('2026-03-11T03:00:00.000Z') // 06:00 IST next day
  })
  it('returns the today occurrence for an overnight shift after start before midnight', () => {
    // Now = 2026-03-10 23:00 IST. Shift 22-06 just started today.
    const now = new Date('2026-03-10T20:00:00.000Z')
    const out = currentRunningOccurrence(mk('a', 22, 0, 6, 0), now, 'Europe/Istanbul')
    expect(out!.occurrenceDay).toBe('2026-03-10')
  })
})

describe('endBoundariesBetween', () => {
  it('returns end boundaries that fall in (from, to] for a same-day shift', () => {
    // Shift 08-16. From 2026-03-10 05:00 UTC to 2026-03-12 17:00 UTC.
    // Day-shift end is at 13:00 UTC each day.
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
    const from = new Date('2026-03-10T13:00:00.000Z') // exact end of 03-10 occurrence
    const to = new Date('2026-03-11T13:00:00.000Z')
    const out = endBoundariesBetween(mk('a', 8, 0, 16, 0), from, to, 'Europe/Istanbul')
    expect(out.map(o => o.endedAt.toISOString())).toEqual(['2026-03-11T13:00:00.000Z'])
  })
  it('handles overnight shift (end on the next calendar day)', () => {
    // Shift 22-06. The 2026-03-10 occurrence ends at 2026-03-11 03:00 UTC.
    const from = new Date('2026-03-10T19:00:00.000Z') // shift just started
    const to = new Date('2026-03-11T05:00:00.000Z')
    const out = endBoundariesBetween(mk('a', 22, 0, 6, 0), from, to, 'Europe/Istanbul')
    expect(out.length).toBe(1)
    expect(out[0]!.endedAt.toISOString()).toBe('2026-03-11T03:00:00.000Z')
    expect(out[0]!.occurrenceDay).toBe('2026-03-10')
  })
  it('returns empty when no end boundary falls inside the range', () => {
    const from = new Date('2026-03-10T05:00:00.000Z') // 08:00 IST
    const to = new Date('2026-03-10T10:00:00.000Z') // 13:00 IST
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
    ).toBe('2026-03-10T21:00:00.000Z') // 00:00 next IST = 21:00 UTC same day
  })
})

describe('isShiftCurrentlyRunning', () => {
  it('is a thin wrapper over currentRunningOccurrence', () => {
    const inside = new Date('2026-03-10T09:00:00.000Z') // 12:00 IST
    const outside = new Date('2026-03-10T14:00:00.000Z') // 17:00 IST
    expect(isShiftCurrentlyRunning(mk('a', 8, 0, 16, 0), inside, 'Europe/Istanbul')).toBe(true)
    expect(isShiftCurrentlyRunning(mk('a', 8, 0, 16, 0), outside, 'Europe/Istanbul')).toBe(false)
  })
})
```

- [ ] **Step 2.2: Run tests — expect failure (module does not exist)**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.utils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2.3: Implement `shift.utils.ts`**

Create `work-center/src/modules/shift/shift.utils.ts`:

```typescript
import { CustomError } from '../../core/errors/index.js'

export type ShiftLike = {
  _id: string | { toString(): string }
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}

/**
 * Convert a shift's start/end to minute offsets within a 24h day.
 * End `00:00` is normalized to 1440 (end-of-day). Keeps overnight shifts
 * as `start > end` so callers can distinguish them.
 */
export function shiftToMinutes(shift: ShiftLike): { start: number; end: number } {
  const start = shift.startHour * 60 + shift.startMinute
  let end = shift.endHour * 60 + shift.endMinute
  if (end === 0) end = 1440
  return { start, end }
}

function expandOvernight(start: number, end: number): Array<[number, number]> {
  // Returns one or two half-open [start, end) intervals on a single abstract day.
  if (start < end) return [[start, end]]
  // Overnight: split into [start, 1440) and [0, end)
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

/**
 * Asserts that no two shifts in the set overlap and that no shift id is duplicated.
 * Throws CustomError with i18n codes:
 *  - `shift.duplicate_in_assignment` when the same shift id appears twice
 *  - `shift.overlap_in_assignment` when two distinct shifts overlap in time
 */
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

/**
 * Return `YYYY-MM-DD` string of the instant as interpreted in `timezone`.
 */
export function computeOccurrenceDay(instant: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // en-CA produces YYYY-MM-DD
  return fmt.format(instant)
}

/**
 * Returns the *strictly future* next start instant for the shift.
 *
 * Used by the scheduler to schedule the next `shift.started` boundary timer.
 * Mid-shift boot does NOT produce a past `started` event — if the shift's
 * today-occurrence has already started, this returns *tomorrow's* start, not
 * the current occurrence's start. This enforces the "no missed-event backfill"
 * rule at the boundary level.
 */
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

/**
 * If `now` falls inside an active occurrence of the shift, return that
 * occurrence's `{ startedAt, endedAt, occurrenceDay }`. Otherwise return null.
 *
 * Handles overnight shifts: an occurrence that started yesterday at 22:00 and
 * ends today at 06:00 is reported with `occurrenceDay = yesterday`.
 */
export function currentRunningOccurrence(
  shift: ShiftLike,
  now: Date,
  timezone: string,
): { startedAt: Date; endedAt: Date; occurrenceDay: string } | null {
  const { start: startMin, end: endMin } = shiftToMinutes(shift)
  const overnight = startMin > endMin
  const today = computeOccurrenceDay(now, timezone)
  // Overnight occurrences may still be running from yesterday.
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

/**
 * Compute the end instant for a single occurrence of `shift` whose
 * `occurrenceDay` (the local date of its start) is given.
 *
 * Used by the active-shift update guard to compute the proposed shift's end
 * time on the currently running occurrence's day.
 */
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

/**
 * Return all occurrences of the shift whose `endedAt` falls in the half-open
 * range `(from, to]` (left-exclusive, right-inclusive).
 *
 * Used by startup reconciliation to find missed shift-end boundaries between
 * a check-in's `checkedInAt` and `now`. Iterates day-by-day in plant-local
 * time, so caller must enforce a safety cap on the range length.
 */
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
  // Overnight occurrences started one calendar day earlier may still end
  // inside the range, so back the start of the walk up by one day.
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

/**
 * Convenience wrapper around `currentRunningOccurrence`.
 */
export function isShiftCurrentlyRunning(
  shift: ShiftLike,
  now: Date,
  timezone: string,
): boolean {
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

/**
 * Convert "plant-local wall clock" `YYYY-MM-DD + minuteOfDay` into a UTC `Date`.
 * Uses Intl to find the exact UTC offset for that wall clock in the given timezone,
 * accounting for DST. Assumes the wall-clock time is unambiguous (DST-spring-forward
 * gaps produce the offset on the nearest valid side, which is acceptable for shifts).
 */
function plantLocalToUtc(yyyyMmDd: string, minuteOfDay: number, timezone: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number) as [number, number, number]
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  // Start with the naive UTC interpretation of the wall clock.
  const naiveUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0, 0)
  // Find the offset that this timezone applies at that instant, then correct.
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
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.utils.test.ts`
Expected: PASS — all 14+ assertions green

- [ ] **Step 2.5: Commit**

```bash
git add work-center/src/modules/shift/shift.utils.ts work-center/src/modules/shift/__tests__/shift.utils.test.ts
git commit -m "feat(work-center/shift): add time normalization and overlap utilities"
```

---

## Task 3: Shift model + validators

**Files:**
- Create: `work-center/src/modules/shift/shift.model.ts`
- Create: `work-center/src/modules/shift/shift.validators.ts`
- Create: `work-center/src/modules/shift/shift.types.ts`
- Modify: `work-center/src/core/loaders/mongoose.ts`

- [ ] **Step 3.1: Create `shift.model.ts`**

```typescript
import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const shiftSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    startHour: { type: Number, required: true, min: 0, max: 23 },
    startMinute: { type: Number, required: true, min: 0, max: 59 },
    endHour: { type: Number, required: true, min: 0, max: 23 },
    endMinute: { type: Number, required: true, min: 0, max: 59 },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, strict: true },
)

// Case-insensitive unique index on trimmed name.
shiftSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
)

shiftSchema.set('toObject', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
shiftSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IShift = InferSchemaType<typeof shiftSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

shiftSchema.plugin(auditLogPlugin)

export const Shift = model<IShift>('Shift', shiftSchema)
```

- [ ] **Step 3.2: Create `shift.types.ts`**

```typescript
import type { IShift } from './shift.model.js'

export type ShiftResponse = IShift
export type CheckoutSource = 'manual' | 'shift_boundary'
```

- [ ] **Step 3.3: Create `shift.validators.ts`**

```typescript
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const timeFields = {
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
}

const sameTimeCheck = (d: {
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}) => !(d.startHour === d.endHour && d.startMinute === d.endMinute)

export const createShiftSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    ...timeFields,
  })
  .strict()
  .refine(sameTimeCheck, { message: 'shift.start_equals_end', path: ['endHour'] })

export const patchShiftSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    startHour: timeFields.startHour.optional(),
    startMinute: timeFields.startMinute.optional(),
    endHour: timeFields.endHour.optional(),
    endMinute: timeFields.endMinute.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const shiftIdParamSchema = z.object({
  id: objectIdSchema,
})

export type CreateShiftInput = z.infer<typeof createShiftSchema>
export type PatchShiftInput = z.infer<typeof patchShiftSchema>
```

- [ ] **Step 3.4: Register the model in the mongoose loader**

In `work-center/src/core/loaders/mongoose.ts`, add the import next to the others:

```typescript
import '../../modules/work-center/work-center.model.js'
import '../../modules/schedule/schedule.model.js'
import '../../modules/shift/shift.model.js'
import '../../modules/operators/operators.model.js'
import '../../modules/action-state/action-state.model.js'
```

- [ ] **Step 3.5: Run typecheck**

Run: `cd work-center && pnpm typecheck`
Expected: PASS

- [ ] **Step 3.6: Commit**

```bash
git add work-center/src/modules/shift/shift.model.ts \
        work-center/src/modules/shift/shift.types.ts \
        work-center/src/modules/shift/shift.validators.ts \
        work-center/src/core/loaders/mongoose.ts
git commit -m "feat(work-center/shift): add shift model and validators"
```

---

## Task 4: Shift CRUD service — create/list/get

**Files:**
- Create: `work-center/src/modules/shift/shift.service.ts`
- Test: `work-center/src/modules/shift/__tests__/shift.service.test.ts`

- [ ] **Step 4.1: Write failing tests for create/list/get**

Create `work-center/src/modules/shift/__tests__/shift.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import { Shift } from '../shift.model.js'
import * as shiftService from '../shift.service.js'

// Prevent scheduler side effects during unit tests.
vi.mock('../shift.scheduler.js', () => ({
  onShiftCreated: vi.fn(),
  onShiftUpdated: vi.fn(),
  onShiftDeleted: vi.fn(),
}))
// Prevent event emission during unit tests.
vi.mock('../../../jobs/events.js', () => ({
  emitShiftCreated: vi.fn(),
  emitShiftUpdated: vi.fn(),
  emitShiftDeleted: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
}))
// Stub out production reference check (tested in integration tests).
vi.mock('../../../lib/internal-api.js', () => ({
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
}))

const userId = new Types.ObjectId().toHexString()

describe('shift.service create/list/get', () => {
  beforeEach(async () => {
    await Shift.deleteMany({})
  })

  it('creates a shift', async () => {
    const shift = await shiftService.createShift(
      { name: 'Morning', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    expect(shift.name).toBe('Morning')
    expect(String(shift.createdBy)).toBe(userId)
  })

  it('rejects duplicate name case-insensitively', async () => {
    await shiftService.createShift(
      { name: 'Morning', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    await expect(
      shiftService.createShift(
        { name: 'MORNING', startHour: 6, startMinute: 0, endHour: 14, endMinute: 0 },
        userId,
      ),
    ).rejects.toMatchObject({ status: 409, message: 'shift.name_in_use' })
  })

  it('rejects when start == end', async () => {
    await expect(
      shiftService.createShift(
        { name: 'Bad', startHour: 8, startMinute: 0, endHour: 8, endMinute: 0 },
        userId,
      ),
    ).rejects.toMatchObject({ status: 400, message: 'shift.start_equals_end' })
  })

  it('allows overlapping shifts in the global catalog', async () => {
    await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    const b = await shiftService.createShift(
      { name: 'B', startHour: 10, startMinute: 0, endHour: 18, endMinute: 0 },
      userId,
    )
    expect(b.name).toBe('B')
  })

  it('lists shifts sorted by name', async () => {
    await shiftService.createShift(
      { name: 'Night', startHour: 22, startMinute: 0, endHour: 6, endMinute: 0 },
      userId,
    )
    await shiftService.createShift(
      { name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    const list = await shiftService.listShifts()
    expect(list.map(s => s.name)).toEqual(['Day', 'Night'])
  })

  it('getShift returns 404 for unknown id', async () => {
    const unknown = new Types.ObjectId().toHexString()
    await expect(shiftService.getShift(unknown)).rejects.toMatchObject({
      status: 404,
      message: 'shift.not_found',
    })
  })
})
```

- [ ] **Step 4.2: Run tests — expect failure (service does not exist yet)**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4.3: Create the initial `shift.service.ts` with create/list/get**

```typescript
import { Types } from 'mongoose'
import { CustomError } from '../../core/errors/index.js'
import {
  emitShiftCreated,
  emitShiftDeleted,
  emitShiftUpdated,
} from '../../jobs/events.js'
import { hasProductionShiftReferences } from '../../lib/internal-api.js'
import { type IShift, Shift } from './shift.model.js'
import {
  onShiftCreated,
  onShiftDeleted,
  onShiftUpdated,
} from './shift.scheduler.js'
import type { CreateShiftInput, PatchShiftInput } from './shift.validators.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertUniqueName(name: string, excludeId?: string): Promise<void> {
  const filter: Record<string, unknown> = {}
  if (excludeId) filter._id = { $ne: excludeId }
  filter.name = name
  const existing = await Shift.findOne(filter)
    .collation({ locale: 'en', strength: 2 })
    .select('_id')
    .lean()
  if (existing) throw new CustomError(409, 'shift.name_in_use')
}

function assertValidTimeRange(data: {
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}): void {
  if (data.startHour === data.endHour && data.startMinute === data.endMinute) {
    throw new CustomError(400, 'shift.start_equals_end')
  }
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createShift(data: CreateShiftInput, userId: string): Promise<IShift> {
  assertValidTimeRange(data)
  await assertUniqueName(data.name)
  const doc = new Shift({
    ...data,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
  const saved = await doc.save()
  onShiftCreated(saved)
  await emitShiftCreated(String(saved._id))
  return saved
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function listShifts(): Promise<IShift[]> {
  return Shift.find().sort({ name: 1 }).select('-__v').lean() as Promise<IShift[]>
}

export async function getShift(id: string): Promise<IShift> {
  const shift = (await Shift.findById(id).select('-__v').lean()) as IShift | null
  if (!shift) throw new CustomError(404, 'shift.not_found')
  return shift
}

// Helpers exposed for other modules to avoid cross-module Model usage.
export async function findShiftsByIds(ids: string[]): Promise<IShift[]> {
  if (ids.length === 0) return []
  return Shift.find({ _id: { $in: ids } }).select('-__v').lean() as Promise<IShift[]>
}

export async function assertShiftsExist(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const count = await Shift.countDocuments({ _id: { $in: ids } })
  if (count !== new Set(ids.map(String)).size) {
    throw new CustomError(404, 'shift.not_found')
  }
}

// ── Placeholders for later tasks ─────────────────────────────────────────────
// updateShift / deleteShift are added in Task 5.

// Re-export so `shift.service.ts` is the single import surface for the module.
export { emitShiftCreated, emitShiftDeleted, emitShiftUpdated }
export { hasProductionShiftReferences }
```

- [ ] **Step 4.4: Create scheduler stub file (so the service imports resolve)**

Create `work-center/src/modules/shift/shift.scheduler.ts` as a stub — real logic is added in Task 8:

```typescript
import type { IShift } from './shift.model.js'

// Stub: real implementation is added in Task 8. Callers from shift.service.ts
// import these so the file must exist now.
export function onShiftCreated(_shift: IShift): void {}
export function onShiftUpdated(_shift: IShift): void {}
export function onShiftDeleted(_shiftId: string): void {}
export async function startShiftScheduler(): Promise<void> {}
export async function stopShiftScheduler(): Promise<void> {}
```

- [ ] **Step 4.5: Add shift events to `jobs/events.ts`**

Add these exports below the existing `Schedule events` block in `work-center/src/jobs/events.ts`:

```typescript
// ── Shift lifecycle events ───────────────────────────────────────────────────

export const emitShiftCreated = (shiftId: string) =>
  emit('work_center.shift.created', { shiftId })

export const emitShiftUpdated = (shiftId: string) =>
  emit('work_center.shift.updated', { shiftId })

export const emitShiftDeleted = (shiftId: string) =>
  emit('work_center.shift.deleted', { shiftId })

// ── Shift boundary events ────────────────────────────────────────────────────

export const emitShiftStarted = (payload: {
  shiftId: string
  name: string
  startedAt: Date
  occurrenceDay: string
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}) => emit('work_center.shift.started', { ...payload, startedAt: payload.startedAt.toISOString() })

export const emitShiftEnded = (payload: {
  shiftId: string
  name: string
  startedAt: Date
  endedAt: Date
  occurrenceDay: string
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}) =>
  emit('work_center.shift.ended', {
    ...payload,
    startedAt: payload.startedAt.toISOString(),
    endedAt: payload.endedAt.toISOString(),
  })
```

- [ ] **Step 4.6: Add `hasProductionShiftReferences` stub to `lib/internal-api.ts`**

At the bottom of `work-center/src/lib/internal-api.ts`, add:

```typescript
const PRODUCTION_API = config.INTERNAL_API_PRODUCTION

async function fetchProduction(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${PRODUCTION_API}/internal/v1${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
}

/**
 * Check if any production record (QuantityAdjustment / ScrapEntry) references this shift.
 * Defaults to `true` (block delete) if production-service is unreachable.
 */
export async function hasProductionShiftReferences(shiftId: string): Promise<boolean> {
  try {
    const res = await fetchProduction(`/shifts/${shiftId}/references`)
    if (!res.ok) {
      logger.warn('Production-service shift reference check failed, blocking delete', {
        event: 'internal_api.production.shift_ref_check_failed',
        shiftId,
        status: res.status,
      })
      return true
    }
    const body = (await res.json()) as { data?: { inUse?: boolean } }
    return body.data?.inUse ?? true
  } catch (err) {
    logger.warn('Cannot reach production-service for shift reference check, blocking delete', {
      event: 'internal_api.production.shift_ref_check_unreachable',
      shiftId,
      error: err instanceof Error ? err.message : err,
    })
    return true
  }
}
```

Also import `config` at the top if not already there (it should be — the file already uses it).

- [ ] **Step 4.7: Run tests to verify create/list/get pass**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.service.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 4.8: Commit**

```bash
git add work-center/src/modules/shift/shift.service.ts \
        work-center/src/modules/shift/shift.scheduler.ts \
        work-center/src/modules/shift/__tests__/shift.service.test.ts \
        work-center/src/jobs/events.ts \
        work-center/src/lib/internal-api.ts
git commit -m "feat(work-center/shift): shift CRUD create/list/get and events"
```

---

## Task 5: Shift update + delete (with reference guards)

**Files:**
- Modify: `work-center/src/modules/shift/shift.service.ts`
- Modify: `work-center/src/modules/shift/__tests__/shift.service.test.ts`

- [ ] **Step 5.1: Write failing tests for update/delete**

Append to `shift.service.test.ts`:

```typescript
import WorkCenter from '../../work-center/work-center.model.js'
import { Calendar, DateException } from '../../schedule/schedule.model.js'
import { hasProductionShiftReferences } from '../../../lib/internal-api.js'

const mockedHasProdRefs = vi.mocked(hasProductionShiftReferences)

describe('shift.service update', () => {
  beforeEach(async () => {
    await Promise.all([
      Shift.deleteMany({}),
      WorkCenter.deleteMany({}),
      Calendar.deleteMany({}),
      DateException.deleteMany({}),
    ])
    mockedHasProdRefs.mockResolvedValue(false)
  })

  it('renames a shift', async () => {
    const s = await shiftService.createShift(
      { name: 'Morning', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    const out = await shiftService.updateShift(String(s._id), { name: 'Day' }, userId)
    expect(out.name).toBe('Day')
  })

  it('rejects rename collision', async () => {
    const a = await shiftService.createShift(
      { name: 'Morning', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    await shiftService.createShift(
      { name: 'Night', startHour: 22, startMinute: 0, endHour: 6, endMinute: 0 },
      userId,
    )
    await expect(
      shiftService.updateShift(String(a._id), { name: 'night' }, userId),
    ).rejects.toMatchObject({ status: 409, message: 'shift.name_in_use' })
  })

  it('rejects time update that would make a referencing work-center assignment overlap', async () => {
    const a = await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
      userId,
    )
    const b = await shiftService.createShift(
      { name: 'B', startHour: 13, startMinute: 0, endHour: 18, endMinute: 0 },
      userId,
    )
    await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [a._id, b._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await expect(
      shiftService.updateShift(String(a._id), { endHour: 14 }, userId),
    ).rejects.toMatchObject({ status: 400, message: 'shift.overlap_in_assignment' })
  })
})

describe('shift.service delete', () => {
  beforeEach(async () => {
    await Promise.all([
      Shift.deleteMany({}),
      WorkCenter.deleteMany({}),
      Calendar.deleteMany({}),
      DateException.deleteMany({}),
    ])
    mockedHasProdRefs.mockResolvedValue(false)
  })

  it('deletes an unreferenced shift', async () => {
    const s = await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    await shiftService.deleteShift(String(s._id))
    expect(await Shift.findById(s._id)).toBeNull()
  })

  it('blocks delete when referenced by WorkCenter.shiftIds', async () => {
    const s = await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [s._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await expect(shiftService.deleteShift(String(s._id))).rejects.toMatchObject({
      status: 409,
      message: 'shift.in_use',
    })
  })

  it('blocks delete when referenced by production (internal API)', async () => {
    const s = await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    mockedHasProdRefs.mockResolvedValue(true)
    await expect(shiftService.deleteShift(String(s._id))).rejects.toMatchObject({
      status: 409,
      message: 'shift.in_use',
    })
  })
})
```

- [ ] **Step 5.2: Run tests — expect failure (updateShift/deleteShift missing)**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.service.test.ts`
Expected: FAIL — `updateShift is not a function`, `deleteShift is not a function`

- [ ] **Step 5.3: Implement update + delete in `shift.service.ts`**

Add these to `shift.service.ts` (remove the placeholder comment block):

```typescript
import WorkCenter from '../work-center/work-center.model.js'
import { Calendar, DateException } from '../schedule/schedule.model.js'
import { assertNoOverlap, type ShiftLike } from './shift.utils.js'

// ── Update ───────────────────────────────────────────────────────────────────

const TIME_FIELDS = ['startHour', 'startMinute', 'endHour', 'endMinute'] as const
type TimeField = (typeof TIME_FIELDS)[number]

function isTimeChange(data: PatchShiftInput): boolean {
  return TIME_FIELDS.some(f => data[f] !== undefined)
}

export async function updateShift(
  id: string,
  data: PatchShiftInput,
  userId: string,
): Promise<IShift> {
  const existing = await Shift.findById(id)
  if (!existing) throw new CustomError(404, 'shift.not_found')

  // Rename guard
  if (data.name !== undefined && data.name !== existing.name) {
    await assertUniqueName(data.name, id)
    existing.name = data.name
  }

  // Time change guard + re-validation of referencing assignment sets
  if (isTimeChange(data)) {
    const proposed: ShiftLike = {
      _id: String(existing._id),
      startHour: data.startHour ?? existing.startHour,
      startMinute: data.startMinute ?? existing.startMinute,
      endHour: data.endHour ?? existing.endHour,
      endMinute: data.endMinute ?? existing.endMinute,
    }
    assertValidTimeRange(proposed)
    await assertReferencingAssignmentsRemainValid(String(existing._id), proposed)

    // Apply time fields
    for (const f of TIME_FIELDS) {
      if (data[f] !== undefined) (existing as unknown as Record<string, number>)[f] = data[f]!
    }
  }

  existing.updatedBy = new Types.ObjectId(userId)
  const saved = await existing.save()
  onShiftUpdated(saved)
  await emitShiftUpdated(String(saved._id))
  return saved
}

/**
 * For each WorkCenter / Calendar day / DateException referencing this shift,
 * replace the old shift with the proposed one and re-run overlap detection on
 * that single assignment set. Fail fast on the first conflict.
 */
async function assertReferencingAssignmentsRemainValid(
  shiftId: string,
  proposed: ShiftLike,
): Promise<void> {
  // WorkCenter.shiftIds
  const workCenters = await WorkCenter.find({ shiftIds: shiftId })
    .select('_id shiftIds')
    .lean()
  for (const wc of workCenters) {
    const set = await resolveAssignmentSet(wc.shiftIds ?? [], shiftId, proposed)
    assertNoOverlap(set)
  }

  // Calendar.weeklyPattern.<day>
  const calendars = await Calendar.find({
    $or: [
      { 'weeklyPattern.monday': shiftId },
      { 'weeklyPattern.tuesday': shiftId },
      { 'weeklyPattern.wednesday': shiftId },
      { 'weeklyPattern.thursday': shiftId },
      { 'weeklyPattern.friday': shiftId },
      { 'weeklyPattern.saturday': shiftId },
      { 'weeklyPattern.sunday': shiftId },
    ],
  })
    .select('_id weeklyPattern')
    .lean()
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
  for (const cal of calendars) {
    const pattern = cal.weeklyPattern as unknown as Record<string, Array<string | { toString(): string }>>
    for (const day of DAYS) {
      const ids = pattern[day] ?? []
      if (!ids.some(i => String(i) === shiftId)) continue
      const set = await resolveAssignmentSet(ids, shiftId, proposed)
      assertNoOverlap(set)
    }
  }

  // DateException.shiftIds
  const exceptions = await DateException.find({ shiftIds: shiftId })
    .select('_id shiftIds')
    .lean()
  for (const ex of exceptions) {
    const set = await resolveAssignmentSet(
      (ex as unknown as { shiftIds: Array<string | { toString(): string }> }).shiftIds ?? [],
      shiftId,
      proposed,
    )
    assertNoOverlap(set)
  }
}

async function resolveAssignmentSet(
  ids: Array<string | { toString(): string }>,
  replaceId: string,
  replacement: ShiftLike,
): Promise<ShiftLike[]> {
  const stringIds = ids.map(String)
  const others = stringIds.filter(i => i !== replaceId)
  if (others.length === 0) return [replacement]
  const docs = (await Shift.find({ _id: { $in: others } })
    .select('_id startHour startMinute endHour endMinute')
    .lean()) as Array<ShiftLike>
  return [...docs, replacement]
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteShift(id: string): Promise<void> {
  const existing = await Shift.findById(id).select('_id').lean()
  if (!existing) throw new CustomError(404, 'shift.not_found')

  // Reference checks — fail if ANY exist
  const [wcRef, calRef, excRef, prodRef] = await Promise.all([
    WorkCenter.exists({ shiftIds: id }),
    Calendar.exists({
      $or: [
        { 'weeklyPattern.monday': id },
        { 'weeklyPattern.tuesday': id },
        { 'weeklyPattern.wednesday': id },
        { 'weeklyPattern.thursday': id },
        { 'weeklyPattern.friday': id },
        { 'weeklyPattern.saturday': id },
        { 'weeklyPattern.sunday': id },
      ],
    }),
    DateException.exists({ shiftIds: id }),
    hasProductionShiftReferences(id),
  ])

  if (wcRef || calRef || excRef || prodRef) {
    throw new CustomError(409, 'shift.in_use')
  }

  await Shift.deleteOne({ _id: id })
  onShiftDeleted(id)
  await emitShiftDeleted(id)
}
```

- [ ] **Step 5.4: Run tests to verify update/delete pass**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.service.test.ts`
Expected: PASS (all previous + 6 new tests)

- [ ] **Step 5.5: Commit**

```bash
git add work-center/src/modules/shift/shift.service.ts \
        work-center/src/modules/shift/__tests__/shift.service.test.ts
git commit -m "feat(work-center/shift): shift update and delete with reference guards"
```

---

## Task 6: Shift controller + routes + mount

**Files:**
- Create: `work-center/src/modules/shift/shift.controller.ts`
- Create: `work-center/src/modules/shift/shift.routes.ts`
- Modify: `work-center/src/core/loaders/express.ts`

- [ ] **Step 6.1: Create `shift.controller.ts`**

```typescript
import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IShift } from './shift.model.js'
import * as shiftService from './shift.service.js'

export const createShift = async (
  req: Request,
  res: Response<SuccessResponse<IShift>>,
) => {
  const shift = await shiftService.createShift(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.shift_created'), data: shift })
}

export const listShifts = async (_req: Request, res: Response<SuccessResponse<IShift[]>>) => {
  const shifts = await shiftService.listShifts()
  res.json({ data: shifts })
}

export const getShift = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IShift>>,
) => {
  const shift = await shiftService.getShift(req.params.id)
  res.json({ data: shift })
}

export const updateShift = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IShift>>,
) => {
  const shift = await shiftService.updateShift(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.shift_updated'), data: shift })
}

export const deleteShift = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<void>>,
) => {
  await shiftService.deleteShift(req.params.id)
  res.json({ message: req.t('success.shift_deleted'), data: undefined })
}
```

- [ ] **Step 6.2: Create `shift.routes.ts`**

```typescript
import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as controller from './shift.controller.js'
import {
  createShiftSchema,
  patchShiftSchema,
  shiftIdParamSchema,
} from './shift.validators.js'

const router = Router()

router.get('/shifts', requirePermission('readSchedules'), controller.listShifts)

router.get(
  '/shifts/:id',
  requirePermission('readSchedules'),
  validateParams(shiftIdParamSchema),
  controller.getShift,
)

router.post(
  '/shifts',
  requirePermission('writeSchedules'),
  validateBody(createShiftSchema),
  controller.createShift,
)

router.patch(
  '/shifts/:id',
  requirePermission('writeSchedules'),
  validateParams(shiftIdParamSchema),
  validateBody(patchShiftSchema),
  controller.updateShift,
)

router.delete(
  '/shifts/:id',
  requirePermission('writeSchedules'),
  validateParams(shiftIdParamSchema),
  controller.deleteShift,
)

export default router
```

- [ ] **Step 6.3: Mount the routes in the Express loader**

In `work-center/src/core/loaders/express.ts`, add the import:

```typescript
import shiftRoutes from '../../modules/shift/shift.routes.js'
```

And mount inside `mountSharedRoutes`:

```typescript
const mountSharedRoutes = (router: ReturnType<typeof Router>) => {
  router.use(workCenterRoutes)
  router.use(scheduleRoutes)
  router.use(shiftRoutes)
  router.use(operatorRoutes)
  router.use(actionStateRoutes)
}
```

- [ ] **Step 6.4: Run typecheck + unit tests**

Run: `cd work-center && pnpm typecheck && pnpm test src/modules/shift`
Expected: PASS

- [ ] **Step 6.5: Commit**

```bash
git add work-center/src/modules/shift/shift.controller.ts \
        work-center/src/modules/shift/shift.routes.ts \
        work-center/src/core/loaders/express.ts
git commit -m "feat(work-center/shift): controller and routes mounted"
```

---

## Task 7: Schedule model refactor — shiftId references

**Files:**
- Modify: `work-center/src/modules/schedule/schedule.model.ts`
- Modify: `work-center/src/modules/schedule/schedule.validators.ts`

- [ ] **Step 7.1: Replace embedded shift sub-schemas with ObjectId arrays and `localDate: string`**

Replace the **entire** `work-center/src/modules/schedule/schedule.model.ts` with:

```typescript
import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

// ── Weekly pattern sub-schema (shiftIds per day) ────────────────────────────

const weeklyPatternSchema = new Schema(
  {
    monday: { type: [Schema.Types.ObjectId], default: [] },
    tuesday: { type: [Schema.Types.ObjectId], default: [] },
    wednesday: { type: [Schema.Types.ObjectId], default: [] },
    thursday: { type: [Schema.Types.ObjectId], default: [] },
    friday: { type: [Schema.Types.ObjectId], default: [] },
    saturday: { type: [Schema.Types.ObjectId], default: [] },
    sunday: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
)

// ── WorkCenterCalendar ──────────────────────────────────────────────────────

const calendarSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true, index: true },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    status: { type: String, enum: ['active', 'retired'], default: 'active' },
    weeklyPattern: { type: weeklyPatternSchema, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, strict: true },
)

calendarSchema.index({ workCenterId: 1, status: 1 })
calendarSchema.set('toObject', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
calendarSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type ICalendar = InferSchemaType<typeof calendarSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

calendarSchema.plugin(auditLogPlugin)

export const Calendar = model<ICalendar>('WorkCenterCalendar', calendarSchema)

// ── DateException ───────────────────────────────────────────────────────────

const dateExceptionSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    // Date-only (YYYY-MM-DD), plant-local. NOT an instant.
    localDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    shiftIds: { type: [Schema.Types.ObjectId], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, strict: true },
)

dateExceptionSchema.index({ workCenterId: 1, localDate: 1 }, { unique: true })
dateExceptionSchema.set('toObject', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
dateExceptionSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IDateException = InferSchemaType<typeof dateExceptionSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

dateExceptionSchema.plugin(auditLogPlugin)

export const DateException = model<IDateException>('DateException', dateExceptionSchema)
```

- [ ] **Step 7.2: Update `schedule.validators.ts` to use shift-id arrays**

Replace its contents with:

```typescript
import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

// ── Weekly pattern (shift id references per day) ────────────────────────────

const dayShiftsSchema = z.array(objectIdSchema).default([])

const weeklyPatternSchema = z
  .object({
    monday: dayShiftsSchema,
    tuesday: dayShiftsSchema,
    wednesday: dayShiftsSchema,
    thursday: dayShiftsSchema,
    friday: dayShiftsSchema,
    saturday: dayShiftsSchema,
    sunday: dayShiftsSchema,
  })
  .strict()

// ── Calendar schemas ────────────────────────────────────────────────────────

export const createCalendarSchema = z
  .object({
    validFrom: utcDateSchema,
    validTo: utcDateSchema,
    weeklyPattern: weeklyPatternSchema,
  })
  .strict()
  .refine(d => d.validFrom < d.validTo, {
    message: 'schedule.valid_from_before_valid_to',
    path: ['validTo'],
  })

export const replaceCalendarSchema = createCalendarSchema

export const patchCalendarSchema = z
  .object({
    validFrom: utcDateSchema.optional(),
    validTo: utcDateSchema.optional(),
    status: z.enum(['active', 'retired']).optional(),
    weeklyPattern: weeklyPatternSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

// ── Date exception schemas ──────────────────────────────────────────────────

export const upsertExceptionSchema = z
  .object({
    shiftIds: z.array(objectIdSchema).default([]),
  })
  .strict()

// ── Param schemas ───────────────────────────────────────────────────────────

export const scheduleWorkCenterIdParamSchema = z.object({
  workCenterId: objectIdSchema,
})

export const calendarIdParamSchema = z.object({
  workCenterId: objectIdSchema,
  calendarId: objectIdSchema,
})

export const exceptionParamSchema = z.object({
  workCenterId: objectIdSchema,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'schedule.invalid_date_format'),
})

export const effectiveScheduleQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'schedule.invalid_date_format'),
})

// ── Type exports ────────────────────────────────────────────────────────────

export type CreateCalendarInput = z.infer<typeof createCalendarSchema>
export type PatchCalendarInput = z.infer<typeof patchCalendarSchema>
export type UpsertExceptionInput = z.infer<typeof upsertExceptionSchema>
```

- [ ] **Step 7.3: Run typecheck — schedule.service.ts will fail; that's expected, fixed in Task 8**

Run: `cd work-center && pnpm typecheck`
Expected: FAIL — schedule.service.ts still references old shapes (intervals, localDate Date). This is fixed in Task 8; do not commit until 8 is complete.

**Do NOT commit yet.** Continue straight to Task 8.

---

## Task 8: Schedule service refactor — uniform response, shiftId resolution, overlap at assignment

**Files:**
- Modify: `work-center/src/modules/schedule/schedule.service.ts`
- Test: `work-center/src/modules/schedule/__tests__/schedule.service.test.ts` (create if missing)

- [ ] **Step 8.1: Write failing tests for the new behaviors**

Create `work-center/src/modules/schedule/__tests__/schedule.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import WorkCenter from '../../work-center/work-center.model.js'
import { Shift } from '../../shift/shift.model.js'
import { Calendar, DateException } from '../schedule.model.js'
import * as scheduleService from '../schedule.service.js'

vi.mock('../../../jobs/events.js', () => ({
  emitScheduleChanged: vi.fn(),
}))

const userId = new Types.ObjectId().toHexString()

async function makeWc(shiftIds: Types.ObjectId[] = []) {
  return WorkCenter.create({
    code: 'WC1',
    name: 'WC1',
    type: 'physical',
    shiftIds,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

async function makeShift(name: string, sh: number, eh: number) {
  return Shift.create({
    name,
    startHour: sh,
    startMinute: 0,
    endHour: eh,
    endMinute: 0,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

describe('schedule.service effective schedule uniform response', () => {
  beforeEach(async () => {
    await Promise.all([
      WorkCenter.deleteMany({}),
      Shift.deleteMany({}),
      Calendar.deleteMany({}),
      DateException.deleteMany({}),
    ])
  })

  it('returns source=none with empty arrays when no definition', async () => {
    const wc = await makeWc()
    const out = await scheduleService.getEffectiveSchedule(String(wc._id), '2026-04-10')
    expect(out).toEqual({ source: 'none', date: '2026-04-10', shiftIds: [], shifts: [] })
  })

  it('returns source=default with WorkCenter.shiftIds when no calendar/exception', async () => {
    const s = await makeShift('Day', 8, 16)
    const wc = await makeWc([s._id])
    const out = await scheduleService.getEffectiveSchedule(String(wc._id), '2026-04-10')
    expect(out.source).toBe('default')
    expect(out.shiftIds).toEqual([String(s._id)])
    expect(out.shifts).toHaveLength(1)
    expect(out.shifts[0]!.name).toBe('Day')
  })

  it('exception closed day returns empty arrays with source=exception', async () => {
    const s = await makeShift('Day', 8, 16)
    const wc = await makeWc([s._id])
    await scheduleService.upsertException(String(wc._id), '2026-04-10', { shiftIds: [] }, userId)
    const out = await scheduleService.getEffectiveSchedule(String(wc._id), '2026-04-10')
    expect(out.source).toBe('exception')
    expect(out.shiftIds).toEqual([])
    expect(out.shifts).toEqual([])
  })

  it('exception overrides calendar and default', async () => {
    const day = await makeShift('Day', 8, 16)
    const night = await makeShift('Night', 22, 6)
    const exceptionShift = await makeShift('Holiday', 9, 13)
    const wc = await makeWc([day._id])
    await scheduleService.upsertException(
      String(wc._id),
      '2026-04-10',
      { shiftIds: [String(exceptionShift._id)] },
      userId,
    )
    const out = await scheduleService.getEffectiveSchedule(String(wc._id), '2026-04-10')
    expect(out.source).toBe('exception')
    expect(out.shiftIds).toEqual([String(exceptionShift._id)])
  })
})

describe('schedule.service overlap enforcement', () => {
  beforeEach(async () => {
    await Promise.all([Shift.deleteMany({}), WorkCenter.deleteMany({}), DateException.deleteMany({})])
  })

  it('rejects exception with overlapping shift ids', async () => {
    const a = await makeShift('A', 8, 16)
    const b = await makeShift('B', 10, 18)
    const wc = await makeWc()
    await expect(
      scheduleService.upsertException(
        String(wc._id),
        '2026-04-10',
        { shiftIds: [String(a._id), String(b._id)] },
        userId,
      ),
    ).rejects.toMatchObject({ status: 400, message: 'shift.overlap_in_assignment' })
  })

  it('rejects exception with duplicate shift id', async () => {
    const a = await makeShift('A', 8, 16)
    const wc = await makeWc()
    await expect(
      scheduleService.upsertException(
        String(wc._id),
        '2026-04-10',
        { shiftIds: [String(a._id), String(a._id)] },
        userId,
      ),
    ).rejects.toMatchObject({ status: 400, message: 'shift.duplicate_in_assignment' })
  })

  it('rejects calendar day pattern containing overlapping shifts', async () => {
    const a = await makeShift('A', 8, 16)
    const b = await makeShift('B', 10, 18)
    const wc = await makeWc()
    await expect(
      scheduleService.createCalendar(
        String(wc._id),
        {
          validFrom: new Date('2026-04-01T00:00:00.000Z'),
          validTo: new Date('2026-05-01T00:00:00.000Z'),
          weeklyPattern: {
            monday: [String(a._id), String(b._id)],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
            sunday: [],
          },
        },
        userId,
      ),
    ).rejects.toMatchObject({ status: 400, message: 'shift.overlap_in_assignment' })
  })

  it('rejects when assigned shift id does not exist', async () => {
    const wc = await makeWc()
    const bogus = new Types.ObjectId().toHexString()
    await expect(
      scheduleService.upsertException(String(wc._id), '2026-04-10', { shiftIds: [bogus] }, userId),
    ).rejects.toMatchObject({ status: 404, message: 'shift.not_found' })
  })
})
```

- [ ] **Step 8.2: Run tests — expect failures**

Run: `cd work-center && pnpm test src/modules/schedule/__tests__/schedule.service.test.ts`
Expected: FAIL (type errors + missing behavior)

- [ ] **Step 8.3: Rewrite `schedule.service.ts` to use shift references, uniform response, and per-assignment overlap**

Replace the entire file contents with:

```typescript
import { Types } from 'mongoose'
import { CustomError } from '../../core/errors/index.js'
import { emitScheduleChanged } from '../../jobs/events.js'
import { Shift, type IShift } from '../shift/shift.model.js'
import { assertNoOverlap, type ShiftLike } from '../shift/shift.utils.js'
import WorkCenter from '../work-center/work-center.model.js'
import { Calendar, DateException, type ICalendar, type IDateException } from './schedule.model.js'
import type {
  CreateCalendarInput,
  PatchCalendarInput,
  UpsertExceptionInput,
} from './schedule.validators.js'

const DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const
type DayOfWeek = (typeof DAYS_OF_WEEK)[number]

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertWorkCenterActive(workCenterId: string) {
  const wc = await WorkCenter.findById(workCenterId).select('_id status').lean()
  if (!wc) throw new CustomError(404, 'work_center.not_found')
  if (wc.status !== 'active') throw new CustomError(400, 'work_center.must_be_active')
}

async function assertNoCalendarDateOverlap(
  workCenterId: string,
  validFrom: Date,
  validTo: Date,
  excludeId?: string,
): Promise<void> {
  const filter: Record<string, unknown> = {
    workCenterId,
    status: 'active',
    validFrom: { $lt: validTo },
    validTo: { $gt: validFrom },
  }
  if (excludeId) filter._id = { $ne: excludeId }
  const overlap = await Calendar.findOne(filter).select('_id').lean()
  if (overlap) throw new CustomError(409, 'schedule.overlapping_validity')
}

/**
 * Loads `Shift` documents for the given ids, asserts they all exist,
 * then runs the overlap detector. Throws on missing / duplicate / overlap.
 */
async function validateShiftAssignment(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const unique = Array.from(new Set(ids.map(String)))
  if (unique.length !== ids.length) {
    throw new CustomError(400, 'shift.duplicate_in_assignment')
  }
  const docs = (await Shift.find({ _id: { $in: unique } })
    .select('_id startHour startMinute endHour endMinute')
    .lean()) as Array<ShiftLike>
  if (docs.length !== unique.length) {
    throw new CustomError(404, 'shift.not_found')
  }
  assertNoOverlap(docs)
}

async function validateWeeklyPattern(
  pattern: Record<DayOfWeek, string[]> | Record<string, string[]>,
): Promise<void> {
  for (const day of DAYS_OF_WEEK) {
    const ids = (pattern as Record<string, string[]>)[day] ?? []
    await validateShiftAssignment(ids.map(String))
  }
}

// ── Calendar CRUD ────────────────────────────────────────────────────────────

export async function createCalendar(
  workCenterId: string,
  data: CreateCalendarInput,
  userId: string,
): Promise<ICalendar> {
  await assertWorkCenterActive(workCenterId)
  await assertNoCalendarDateOverlap(workCenterId, data.validFrom, data.validTo)
  await validateWeeklyPattern(data.weeklyPattern as unknown as Record<DayOfWeek, string[]>)

  const doc = new Calendar({
    ...data,
    workCenterId,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
  const saved = await doc.save()
  await emitScheduleChanged(workCenterId)
  return saved
}

export async function getCalendar(workCenterId: string, calendarId: string): Promise<ICalendar> {
  const cal = await Calendar.findOne({ _id: calendarId, workCenterId }).select('-__v').lean()
  if (!cal) throw new CustomError(404, 'schedule.calendar_not_found')
  return cal as ICalendar
}

export async function getCalendars(workCenterId: string): Promise<ICalendar[]> {
  return Calendar.find({ workCenterId }).sort({ validFrom: -1 }).select('-__v').lean() as Promise<
    ICalendar[]
  >
}

export async function replaceCalendar(
  workCenterId: string,
  calendarId: string,
  data: CreateCalendarInput,
  userId: string,
): Promise<ICalendar> {
  const existing = await Calendar.findOne({ _id: calendarId, workCenterId })
  if (!existing) throw new CustomError(404, 'schedule.calendar_not_found')
  if (existing.status !== 'active') throw new CustomError(400, 'work_center.must_be_active')
  await assertWorkCenterActive(workCenterId)
  await assertNoCalendarDateOverlap(workCenterId, data.validFrom, data.validTo, calendarId)
  await validateWeeklyPattern(data.weeklyPattern as unknown as Record<DayOfWeek, string[]>)
  Object.assign(existing, data)
  existing.updatedBy = new Types.ObjectId(userId)
  const saved = await existing.save()
  await emitScheduleChanged(workCenterId)
  return saved
}

export async function updateCalendar(
  workCenterId: string,
  calendarId: string,
  data: PatchCalendarInput,
  userId: string,
): Promise<ICalendar> {
  const existing = await Calendar.findOne({ _id: calendarId, workCenterId })
  if (!existing) throw new CustomError(404, 'schedule.calendar_not_found')

  const finalValidFrom = data.validFrom ?? existing.validFrom
  const finalValidTo = data.validTo ?? existing.validTo

  if (finalValidFrom >= finalValidTo) {
    throw new CustomError(400, 'schedule.valid_from_before_valid_to')
  }
  if (data.validFrom || data.validTo) {
    await assertNoCalendarDateOverlap(workCenterId, finalValidFrom, finalValidTo, calendarId)
  }
  if (data.weeklyPattern) {
    await validateWeeklyPattern(data.weeklyPattern as unknown as Record<DayOfWeek, string[]>)
  }

  for (const [k, v] of Object.entries(data)) {
    ;(existing as unknown as Record<string, unknown>)[k] = v
  }
  existing.updatedBy = new Types.ObjectId(userId)
  const saved = await existing.save()
  await emitScheduleChanged(workCenterId)
  return saved
}

export async function deleteCalendar(workCenterId: string, calendarId: string): Promise<void> {
  const result = await Calendar.deleteOne({ _id: calendarId, workCenterId })
  if (result.deletedCount === 0) throw new CustomError(404, 'schedule.calendar_not_found')
  await emitScheduleChanged(workCenterId)
}

// ── Date exception CRUD ─────────────────────────────────────────────────────

export async function upsertException(
  workCenterId: string,
  localDate: string,
  data: UpsertExceptionInput,
  userId: string,
): Promise<IDateException> {
  await assertWorkCenterActive(workCenterId)
  await validateShiftAssignment(data.shiftIds.map(String))

  const doc = await DateException.findOneAndUpdate(
    { workCenterId, localDate },
    {
      $set: {
        shiftIds: data.shiftIds,
        updatedBy: new Types.ObjectId(userId),
      },
      $setOnInsert: {
        workCenterId,
        localDate,
        createdBy: new Types.ObjectId(userId),
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  )
  await emitScheduleChanged(workCenterId)
  return doc!
}

export async function deleteException(workCenterId: string, localDate: string): Promise<void> {
  const result = await DateException.deleteOne({ workCenterId, localDate })
  if (result.deletedCount === 0) throw new CustomError(404, 'schedule.exception_not_found')
  await emitScheduleChanged(workCenterId)
}

// ── Effective schedule (uniform response) ───────────────────────────────────

export type EffectiveScheduleSource = 'exception' | 'calendar' | 'default' | 'none'
export type EffectiveScheduleResponse = {
  source: EffectiveScheduleSource
  date: string
  shiftIds: string[]
  shifts: IShift[]
}

export async function getEffectiveSchedule(
  workCenterId: string,
  date: string,
): Promise<EffectiveScheduleResponse> {
  const wc = await WorkCenter.findById(workCenterId).select('_id shiftIds').lean()
  if (!wc) throw new CustomError(404, 'work_center.not_found')

  // 1. DateException
  const exception = await DateException.findOne({ workCenterId, localDate: date })
    .select('shiftIds')
    .lean()
  if (exception) {
    const ids = (exception.shiftIds ?? []).map(String)
    const shifts = await hydrateShifts(ids)
    return { source: 'exception', date, shiftIds: ids, shifts }
  }

  // 2. Active calendar covering the date
  const dateObj = new Date(`${date}T00:00:00.000Z`)
  const calendar = await Calendar.findOne({
    workCenterId,
    status: 'active',
    validFrom: { $lte: dateObj },
    validTo: { $gte: dateObj },
  })
    .select('weeklyPattern')
    .lean()
  if (calendar) {
    const dayName = DAYS_OF_WEEK[dateObj.getUTCDay()] as DayOfWeek
    const pattern = calendar.weeklyPattern as unknown as Record<DayOfWeek, Array<string | { toString(): string }>>
    const ids = (pattern[dayName] ?? []).map(String)
    const shifts = await hydrateShifts(ids)
    return { source: 'calendar', date, shiftIds: ids, shifts }
  }

  // 3. Default (WorkCenter.shiftIds)
  const defaultIds = (wc.shiftIds ?? []).map(String)
  if (defaultIds.length > 0) {
    const shifts = await hydrateShifts(defaultIds)
    return { source: 'default', date, shiftIds: defaultIds, shifts }
  }

  // 4. None
  return { source: 'none', date, shiftIds: [], shifts: [] }
}

async function hydrateShifts(ids: string[]): Promise<IShift[]> {
  if (ids.length === 0) return []
  const docs = (await Shift.find({ _id: { $in: ids } }).select('-__v').lean()) as IShift[]
  // Preserve input order.
  const byId = new Map(docs.map(d => [String(d._id), d]))
  return ids.map(id => byId.get(id)).filter((d): d is IShift => !!d)
}

// ── Helpers consumed by work-center delete guards ───────────────────────────

export async function hasActiveCalendars(workCenterId: string): Promise<boolean> {
  const count = await Calendar.countDocuments({ workCenterId, status: 'active' })
  return count > 0
}

// ── Helpers consumed by shift-ended consumer / reconciliation ──────────────

/**
 * Find work centers whose effective schedule for `occurrenceDay` currently
 * resolves to a set containing `shiftId`. Used by auto check-out to decide
 * which work centers to touch. Uses effective schedule at call time — never
 * a stored snapshot.
 */
export async function resolveAffectedWorkCenters(
  shiftId: string,
  occurrenceDay: string,
): Promise<string[]> {
  const all = await WorkCenter.find({ status: 'active' }).select('_id').lean()
  const affected: string[] = []
  for (const wc of all) {
    const eff = await getEffectiveSchedule(String(wc._id), occurrenceDay)
    if (eff.shiftIds.includes(shiftId)) affected.push(String(wc._id))
  }
  return affected
}
```

- [ ] **Step 8.4: Run the new schedule tests**

Run: `cd work-center && pnpm test src/modules/schedule/__tests__/schedule.service.test.ts`
Expected: PASS (all ~8 tests)

- [ ] **Step 8.5: Run full typecheck**

Run: `cd work-center && pnpm typecheck`
Expected: PASS. If any other module breaks, fix it — usually a leftover `intervals` reference in the schedule controller; change it to return the new response shape directly (controller already just forwards `res.json({ data: schedule })` so no change needed).

- [ ] **Step 8.6: Commit**

```bash
git add work-center/src/modules/schedule/schedule.model.ts \
        work-center/src/modules/schedule/schedule.validators.ts \
        work-center/src/modules/schedule/schedule.service.ts \
        work-center/src/modules/schedule/__tests__/schedule.service.test.ts
git commit -m "refactor(work-center/schedule): replace embedded shifts with shift id references"
```

---

## Task 9: WorkCenter.shiftIds assignment overlap enforcement

**Files:**
- Modify: `work-center/src/modules/work-center/work-center.service.ts`
- Modify: `work-center/src/modules/work-center/work-center.validators.ts`
- Test: `work-center/src/modules/work-center/__tests__/work-center.shift-ids.test.ts`

- [ ] **Step 9.1: Write failing test**

Create `work-center/src/modules/work-center/__tests__/work-center.shift-ids.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import WorkCenter from '../work-center.model.js'
import { Shift } from '../../shift/shift.model.js'
import * as workCenterService from '../work-center.service.js'

vi.mock('../../../jobs/events.js', () => ({
  emitWorkCenterCreated: vi.fn(),
  emitWorkCenterUpdated: vi.fn(),
  emitWorkCenterArchived: vi.fn(),
  emitWorkCenterReactivated: vi.fn(),
  emitWorkCenterDeleted: vi.fn(),
  emitHierarchyChanged: vi.fn(),
  emitMetricCompositionChanged: vi.fn(),
  emitScheduleChanged: vi.fn(),
  emitOperatorCheckedIn: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
  emitActionStateChanged: vi.fn(),
}))
vi.mock('../../../lib/internal-api.js', () => ({
  addWorkCenterToUser: vi.fn(),
  isWorkCenterReferencedByUsers: vi.fn().mockResolvedValue(false),
  validateOperatorExists: vi.fn().mockResolvedValue(true),
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
}))

const userId = new Types.ObjectId().toHexString()

async function mkShift(name: string, sh: number, eh: number) {
  return Shift.create({
    name,
    startHour: sh,
    startMinute: 0,
    endHour: eh,
    endMinute: 0,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

describe('workCenter.shiftIds update', () => {
  beforeEach(async () => {
    await Promise.all([WorkCenter.deleteMany({}), Shift.deleteMany({})])
  })

  it('accepts non-overlapping set', async () => {
    const a = await mkShift('A', 8, 16)
    const b = await mkShift('B', 16, 0) // 16:00 - 00:00, adjacent not overlapping
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const updated = await workCenterService.updateWorkCenter(
      String(wc._id),
      { shiftIds: [String(a._id), String(b._id)] },
      userId,
    )
    expect(updated.shiftIds.map(String)).toEqual([String(a._id), String(b._id)])
  })

  it('rejects overlapping set', async () => {
    const a = await mkShift('A', 8, 16)
    const b = await mkShift('B', 10, 18)
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await expect(
      workCenterService.updateWorkCenter(
        String(wc._id),
        { shiftIds: [String(a._id), String(b._id)] },
        userId,
      ),
    ).rejects.toMatchObject({ status: 400, message: 'shift.overlap_in_assignment' })
  })

  it('rejects non-existent shift id', async () => {
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const bogus = new Types.ObjectId().toHexString()
    await expect(
      workCenterService.updateWorkCenter(String(wc._id), { shiftIds: [bogus] }, userId),
    ).rejects.toMatchObject({ status: 404, message: 'shift.not_found' })
  })
})
```

- [ ] **Step 9.2: Run test — expect failure**

Run: `cd work-center && pnpm test src/modules/work-center/__tests__/work-center.shift-ids.test.ts`
Expected: FAIL — shiftIds not validated

- [ ] **Step 9.3: Add shiftIds to work-center patch validator**

In `work-center/src/modules/work-center/work-center.validators.ts`, add `shiftIds: z.array(objectIdSchema).optional()` to the patch/replace schemas. Example addition to the patch schema:

```typescript
import { objectIdSchema } from '../../utils/validators.js'

// inside patchWorkCenterSchema object:
    shiftIds: z.array(objectIdSchema).optional(),
```

(Do the same in `physicalReplaceSchema` and `virtualReplaceSchema` if they exist as full replace shapes — use whichever existing replace schemas the file defines.)

- [ ] **Step 9.4: Enforce shift validation in `updateWorkCenter`**

In `work-center/src/modules/work-center/work-center.service.ts` add:

```typescript
import { Shift } from '../shift/shift.model.js'
import { assertNoOverlap, type ShiftLike } from '../shift/shift.utils.js'
```

Add a helper:

```typescript
async function validateShiftIdsAssignment(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const unique = Array.from(new Set(ids.map(String)))
  if (unique.length !== ids.length) {
    throw new CustomError(400, 'shift.duplicate_in_assignment')
  }
  const docs = (await Shift.find({ _id: { $in: unique } })
    .select('_id startHour startMinute endHour endMinute')
    .lean()) as Array<ShiftLike>
  if (docs.length !== unique.length) {
    throw new CustomError(404, 'shift.not_found')
  }
  assertNoOverlap(docs)
}
```

In `updateWorkCenter`, before saving, add:

```typescript
if (data.shiftIds !== undefined) {
  await validateShiftIdsAssignment(data.shiftIds.map(String))
}
```

Also call the same helper in `createWorkCenter` if the create input allows `shiftIds`.

- [ ] **Step 9.5: Run the test to verify it passes**

Run: `cd work-center && pnpm test src/modules/work-center/__tests__/work-center.shift-ids.test.ts`
Expected: PASS

- [ ] **Step 9.6: Commit**

```bash
git add work-center/src/modules/work-center/work-center.service.ts \
        work-center/src/modules/work-center/work-center.validators.ts \
        work-center/src/modules/work-center/__tests__/work-center.shift-ids.test.ts
git commit -m "feat(work-center): enforce shift existence and overlap on shiftIds updates"
```

---

## Task 10: OperatorCheckIn.checkoutSource field + manual default

**Files:**
- Modify: `work-center/src/modules/operators/operators.model.ts`
- Modify: `work-center/src/modules/operators/operators.service.ts`
- Modify: `work-center/src/jobs/events.ts`

- [ ] **Step 10.1: Add `checkoutSource` field to the schema**

In `work-center/src/modules/operators/operators.model.ts`, inside the schema object, after `shiftId`:

```typescript
    shiftId: { type: Schema.Types.ObjectId, default: null },
    checkoutSource: {
      type: String,
      enum: ['manual', 'shift_boundary'],
      default: null,
    },
```

- [ ] **Step 10.2: Write `checkoutSource` on manual check-out**

In `work-center/src/modules/operators/operators.service.ts`, modify `checkOut`:

```typescript
  record.checkedOutAt = new Date()
  record.updatedBy = new Types.ObjectId(userId)
  record.checkoutSource = 'manual'
```

And modify the existing `autoCheckOutByShift` (to be replaced in the next task) placeholder — for now, also set `checkoutSource = 'shift_boundary'` to keep tests green.

- [ ] **Step 10.3: Update `emitOperatorCheckedOut` to carry `checkoutSource`**

In `work-center/src/jobs/events.ts`, replace:

```typescript
export const emitOperatorCheckedOut = (
  workCenterId: string,
  operatorId: string,
  checkInId: string,
) => emit('work_center.operator.checked_out', { workCenterId, operatorId, checkInId })
```

with:

```typescript
export const emitOperatorCheckedOut = (
  workCenterId: string,
  operatorId: string,
  checkInId: string,
  checkoutSource: 'manual' | 'shift_boundary',
) =>
  emit('work_center.operator.checked_out', {
    workCenterId,
    operatorId,
    checkInId,
    checkoutSource,
  })
```

- [ ] **Step 10.4: Update call sites to pass `checkoutSource`**

In `operators.service.ts`, both `checkOut` and `autoCheckOutByShift` must update their `emitOperatorCheckedOut(...)` calls:

- `checkOut` → `'manual'`
- `autoCheckOutByShift` → `'shift_boundary'`

- [ ] **Step 10.5: Write a test for `checkoutSource` persistence**

Create `work-center/src/modules/operators/__tests__/operators.checkout-source.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import WorkCenter from '../../work-center/work-center.model.js'
import { OperatorCheckIn } from '../operators.model.js'
import * as operatorService from '../operators.service.js'

vi.mock('../../../jobs/events.js', () => ({
  emitOperatorCheckedIn: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
}))
vi.mock('../../../lib/internal-api.js', () => ({
  validateOperatorExists: vi.fn().mockResolvedValue(true),
  addWorkCenterToUser: vi.fn(),
  isWorkCenterReferencedByUsers: vi.fn().mockResolvedValue(false),
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
}))

const userId = new Types.ObjectId().toHexString()

describe('operators checkoutSource', () => {
  beforeEach(async () => {
    await Promise.all([WorkCenter.deleteMany({}), OperatorCheckIn.deleteMany({})])
  })

  it('writes manual on user-triggered check-out', async () => {
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const opId = new Types.ObjectId().toHexString()
    const ci = await operatorService.checkIn(String(wc._id), { operatorId: opId }, userId)
    const out = await operatorService.checkOut(String(wc._id), String(ci._id), userId)
    expect(out.checkoutSource).toBe('manual')
  })
})
```

- [ ] **Step 10.6: Run the test**

Run: `cd work-center && pnpm test src/modules/operators/__tests__/operators.checkout-source.test.ts`
Expected: PASS

- [ ] **Step 10.7: Commit**

```bash
git add work-center/src/modules/operators/operators.model.ts \
        work-center/src/modules/operators/operators.service.ts \
        work-center/src/modules/operators/__tests__/operators.checkout-source.test.ts \
        work-center/src/jobs/events.ts
git commit -m "feat(work-center/operators): add checkoutSource field and include in events"
```

---

## Task 11: Auto check-out by shift end (event handler)

**Files:**
- Modify: `work-center/src/modules/operators/operators.service.ts`
- Test: `work-center/src/modules/operators/__tests__/operators.auto-checkout.test.ts`

- [ ] **Step 11.1: Write failing test**

Create `work-center/src/modules/operators/__tests__/operators.auto-checkout.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import WorkCenter from '../../work-center/work-center.model.js'
import { Shift } from '../../shift/shift.model.js'
import { OperatorCheckIn } from '../operators.model.js'
import * as operatorService from '../operators.service.js'
import { emitOperatorCheckedOut } from '../../../jobs/events.js'

vi.mock('../../../jobs/events.js', () => ({
  emitOperatorCheckedIn: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
}))
vi.mock('../../../lib/internal-api.js', () => ({
  validateOperatorExists: vi.fn().mockResolvedValue(true),
  addWorkCenterToUser: vi.fn(),
  isWorkCenterReferencedByUsers: vi.fn().mockResolvedValue(false),
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
}))

const mockedEmit = vi.mocked(emitOperatorCheckedOut)
const userId = new Types.ObjectId().toHexString()

async function mkShift(name: string, sh: number, eh: number) {
  return Shift.create({
    name,
    startHour: sh,
    startMinute: 0,
    endHour: eh,
    endMinute: 0,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

async function mkWc(name: string, shiftIds: Types.ObjectId[] = []) {
  return WorkCenter.create({
    code: name,
    name,
    type: 'physical',
    shiftIds,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

describe('autoCheckOutByShiftEnd', () => {
  beforeEach(async () => {
    await Promise.all([
      WorkCenter.deleteMany({}),
      Shift.deleteMany({}),
      OperatorCheckIn.deleteMany({}),
    ])
    mockedEmit.mockClear()
  })

  it('closes open check-ins only on work centers whose effective schedule contains the shift', async () => {
    const shift = await mkShift('Day', 8, 16)
    const other = await mkShift('Other', 18, 22)
    const wcAffected = await mkWc('WC_A', [shift._id])
    const wcUntouched = await mkWc('WC_B', [other._id])

    const ciA = await operatorService.checkIn(
      String(wcAffected._id),
      { operatorId: new Types.ObjectId().toHexString() },
      userId,
    )
    const ciB = await operatorService.checkIn(
      String(wcUntouched._id),
      { operatorId: new Types.ObjectId().toHexString() },
      userId,
    )

    const result = await operatorService.autoCheckOutByShiftEnd(
      String(shift._id),
      '2026-04-10',
    )
    expect(result).toEqual({ affectedWorkCenterIds: [String(wcAffected._id)], closedCheckInIds: [String(ciA._id)] })

    const a = await OperatorCheckIn.findById(ciA._id)
    const b = await OperatorCheckIn.findById(ciB._id)
    expect(a?.checkedOutAt).toBeTruthy()
    expect(a?.checkoutSource).toBe('shift_boundary')
    expect(b?.checkedOutAt).toBeNull()

    expect(mockedEmit).toHaveBeenCalledWith(
      String(wcAffected._id),
      expect.any(String),
      String(ciA._id),
      'shift_boundary',
    )
  })

  it('is idempotent — repeated call does not re-close or re-emit', async () => {
    const shift = await mkShift('Day', 8, 16)
    const wc = await mkWc('WC_A', [shift._id])
    await operatorService.checkIn(
      String(wc._id),
      { operatorId: new Types.ObjectId().toHexString() },
      userId,
    )
    await operatorService.autoCheckOutByShiftEnd(String(shift._id), '2026-04-10')
    mockedEmit.mockClear()
    const second = await operatorService.autoCheckOutByShiftEnd(String(shift._id), '2026-04-10')
    expect(second.closedCheckInIds).toEqual([])
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('closes check-in records with shiftId: null on an affected work center', async () => {
    const shift = await mkShift('Day', 8, 16)
    const wc = await mkWc('WC_A', [shift._id])
    const ci = await operatorService.checkIn(
      String(wc._id),
      { operatorId: new Types.ObjectId().toHexString() }, // no shiftId
      userId,
    )
    await operatorService.autoCheckOutByShiftEnd(String(shift._id), '2026-04-10')
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt).toBeTruthy()
  })

  it('respects closed-day exception (source=exception, shiftIds=[])', async () => {
    const shift = await mkShift('Day', 8, 16)
    const wc = await mkWc('WC_A', [shift._id])
    const { upsertException } = await import('../../schedule/schedule.service.js')
    await upsertException(String(wc._id), '2026-04-10', { shiftIds: [] }, userId)

    const ci = await operatorService.checkIn(
      String(wc._id),
      { operatorId: new Types.ObjectId().toHexString() },
      userId,
    )
    const result = await operatorService.autoCheckOutByShiftEnd(
      String(shift._id),
      '2026-04-10',
    )
    // The exception on that day removed the shift → WC is NOT affected → no close.
    expect(result.affectedWorkCenterIds).toEqual([])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt).toBeNull()
  })
})
```

- [ ] **Step 11.2: Run test — expect failure**

Run: `cd work-center && pnpm test src/modules/operators/__tests__/operators.auto-checkout.test.ts`
Expected: FAIL — `autoCheckOutByShiftEnd is not a function`

- [ ] **Step 11.3: Implement `autoCheckOutByShiftEnd` in `operators.service.ts`**

Replace the existing `autoCheckOutByShift(workCenterId)` helper with:

```typescript
import { resolveAffectedWorkCenters } from '../schedule/schedule.service.js'

/**
 * Close open check-ins for all work centers whose effective schedule for
 * `occurrenceDay` currently contains `shiftId`. Uses the effective schedule at
 * call time (NO stored snapshot). Idempotent.
 */
export async function autoCheckOutByShiftEnd(
  shiftId: string,
  occurrenceDay: string,
): Promise<{ affectedWorkCenterIds: string[]; closedCheckInIds: string[] }> {
  const affectedWorkCenterIds = await resolveAffectedWorkCenters(shiftId, occurrenceDay)
  const closedCheckInIds: string[] = []
  const now = new Date()

  for (const wcId of affectedWorkCenterIds) {
    const openCheckIns = await OperatorCheckIn.find({
      workCenterId: wcId,
      checkedOutAt: null,
    })
    for (const ci of openCheckIns) {
      ci.checkedOutAt = now
      ci.checkoutSource = 'shift_boundary'
      ci.updatedBy = new Types.ObjectId(SYSTEM_IDENTITY)
      await ci.save()
      await emitOperatorCheckedOut(wcId, String(ci.operatorId), String(ci._id), 'shift_boundary')
      closedCheckInIds.push(String(ci._id))
    }
  }

  return { affectedWorkCenterIds, closedCheckInIds }
}
```

Delete (or mark deprecated) the old `autoCheckOutByShift(workCenterId)` since no code consumes it any more. Search for any lingering callers with `grep -r autoCheckOutByShift work-center/src` and remove them if found.

- [ ] **Step 11.4: Run tests to verify**

Run: `cd work-center && pnpm test src/modules/operators/__tests__/operators.auto-checkout.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 11.5: Commit**

```bash
git add work-center/src/modules/operators/operators.service.ts \
        work-center/src/modules/operators/__tests__/operators.auto-checkout.test.ts
git commit -m "feat(work-center/operators): autoCheckOutByShiftEnd uses effective schedule at processing time"
```

---

## Task 12: Subscribe to `work_center.shift.ended` in subscribers

**Files:**
- Modify: `work-center/src/jobs/subscribers.ts`

- [ ] **Step 12.1: Add a handler for `work_center.shift.ended`**

In `work-center/src/jobs/subscribers.ts`, extend the `streams` object:

```typescript
import { autoCheckOutByShiftEnd } from '../modules/operators/operators.service.js'

const streams = {
  'events.user': {
    'user.updated': async (data: { userId: string }) => {
      await sharedCacheDel(buildAuthContextCacheKey(data.userId))
      logger.debug('Invalidated auth context cache', {
        event: 'cache.auth_context.invalidated',
        userId: data.userId,
      })
    },
  },
  'events.work_center': {
    'work_center.shift.ended': async (data: { shiftId: string; occurrenceDay: string }) => {
      const result = await autoCheckOutByShiftEnd(data.shiftId, data.occurrenceDay)
      logger.info('Shift ended auto check-out processed', {
        event: 'operators.auto_checkout.shift_ended',
        shiftId: data.shiftId,
        occurrenceDay: data.occurrenceDay,
        affectedCount: result.affectedWorkCenterIds.length,
        closedCount: result.closedCheckInIds.length,
      })
    },
  },
}
```

Note: the service both publishes and consumes `events.work_center` — the consumer group prevents the publisher from re-processing its own events only if the group is distinct. Since the work-center service IS the consumer, the consumer group `work-center-service` and consumer `wc-${pid}` will pick up its own shift.ended events. That is intentional — the scheduler fires the boundary, the subscriber reacts.

- [ ] **Step 12.2: Run typecheck**

Run: `cd work-center && pnpm typecheck`
Expected: PASS

- [ ] **Step 12.3: Commit**

```bash
git add work-center/src/jobs/subscribers.ts
git commit -m "feat(work-center/jobs): consume shift.ended to trigger auto check-out"
```

---

## Task 13: Shift scheduler (in-process setTimeout)

**Files:**
- Modify: `work-center/src/modules/shift/shift.scheduler.ts`
- Test: `work-center/src/modules/shift/__tests__/shift.scheduler.test.ts`

- [ ] **Step 13.1: Write failing scheduler tests with fake timers**

Create `work-center/src/modules/shift/__tests__/shift.scheduler.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import { Shift } from '../shift.model.js'
import * as scheduler from '../shift.scheduler.js'
import { emitShiftEnded, emitShiftStarted } from '../../../jobs/events.js'

vi.mock('../../../jobs/events.js', () => ({
  emitShiftCreated: vi.fn(),
  emitShiftUpdated: vi.fn(),
  emitShiftDeleted: vi.fn(),
  emitShiftStarted: vi.fn(),
  emitShiftEnded: vi.fn(),
}))

const mockedStart = vi.mocked(emitShiftStarted)
const mockedEnd = vi.mocked(emitShiftEnded)
const userId = new Types.ObjectId().toHexString()

async function createShift(name: string, sh: number, eh: number) {
  return Shift.create({
    name,
    startHour: sh,
    startMinute: 0,
    endHour: eh,
    endMinute: 0,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

describe('shift.scheduler', () => {
  beforeEach(async () => {
    await Shift.deleteMany({})
    mockedStart.mockClear()
    mockedEnd.mockClear()
    // Pin wall clock to 2026-04-10 05:00 Istanbul (= 02:00 UTC)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T02:00:00.000Z'))
  })

  afterEach(async () => {
    await scheduler.stopShiftScheduler()
    vi.useRealTimers()
  })

  it('rebuilds timers from DB on start and fires start+end', async () => {
    const s = await createShift('Day', 8, 16) // 08:00-16:00 Istanbul
    await scheduler.startShiftScheduler()

    // Advance to 08:00 IST (05:00 UTC) → shift.started
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(mockedStart).toHaveBeenCalledTimes(1)
    expect(mockedStart.mock.calls[0]![0]).toMatchObject({
      shiftId: String(s._id),
      occurrenceDay: '2026-04-10',
    })

    // Advance to 16:00 IST (13:00 UTC) → shift.ended
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
    expect(mockedEnd).toHaveBeenCalledTimes(1)
    expect(mockedEnd.mock.calls[0]![0]).toMatchObject({
      shiftId: String(s._id),
      occurrenceDay: '2026-04-10',
    })
  })

  it('onShiftCreated schedules a new shift mid-run', async () => {
    await scheduler.startShiftScheduler()
    const s = await createShift('Day', 8, 16)
    scheduler.onShiftCreated(s as unknown as { _id: unknown; name: string; startHour: number; startMinute: number; endHour: number; endMinute: number })
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(mockedStart).toHaveBeenCalledTimes(1)
  })

  it('onShiftDeleted cancels future timers (no events after delete)', async () => {
    const s = await createShift('Day', 8, 16)
    await scheduler.startShiftScheduler()
    scheduler.onShiftDeleted(String(s._id))
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(mockedStart).not.toHaveBeenCalled()
    expect(mockedEnd).not.toHaveBeenCalled()
  })

  it('onShiftUpdated reschedules cleanly (no duplicate timers)', async () => {
    const s = await createShift('Day', 8, 16)
    await scheduler.startShiftScheduler()
    // Change end to 17:00
    s.endHour = 17
    await s.save()
    scheduler.onShiftUpdated(s as unknown as { _id: unknown; name: string; startHour: number; startMinute: number; endHour: number; endMinute: number })

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000) // → 08:00 IST
    expect(mockedStart).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9 * 60 * 60 * 1000) // → 17:00 IST
    expect(mockedEnd).toHaveBeenCalledTimes(1)
  })

  it('does not publish synthetic shift.started when service boots mid-shift', async () => {
    // Pin time to 2026-04-10 12:00 IST (= 09:00 UTC). Shift 08-16 is currently running.
    // The "no missed-event backfill" rule means we MUST NOT emit a started event
    // for the past 08:00 boundary. We should still emit ended at 16:00 IST.
    vi.setSystemTime(new Date('2026-04-10T09:00:00.000Z'))
    const s = await createShift('Day', 8, 16)
    await scheduler.startShiftScheduler()

    // Advance ~4h up to just before today's 16:00 IST end → no events yet.
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 - 1)
    expect(mockedStart).not.toHaveBeenCalled()
    expect(mockedEnd).not.toHaveBeenCalled()

    // Cross 16:00 IST → end fires once for today's occurrence.
    await vi.advanceTimersByTimeAsync(1)
    expect(mockedEnd).toHaveBeenCalledTimes(1)
    expect(mockedEnd.mock.calls[0]![0]).toMatchObject({
      shiftId: String(s._id),
      occurrenceDay: '2026-04-10',
    })
    // Started must STILL not have been called for today.
    expect(mockedStart).not.toHaveBeenCalled()

    // Advance 16h to next day 08:00 IST → started fires for tomorrow's occurrence.
    await vi.advanceTimersByTimeAsync(16 * 60 * 60 * 1000)
    expect(mockedStart).toHaveBeenCalledTimes(1)
    expect(mockedStart.mock.calls[0]![0]).toMatchObject({
      shiftId: String(s._id),
      occurrenceDay: '2026-04-11',
    })
  })
})
```

- [ ] **Step 13.2: Run — expect failure (stub scheduler does nothing)**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.scheduler.test.ts`
Expected: FAIL

- [ ] **Step 13.3: Implement `shift.scheduler.ts`**

Replace the stub in `work-center/src/modules/shift/shift.scheduler.ts` with:

```typescript
import { config } from '../../config/index.js'
import { emitShiftEnded, emitShiftStarted } from '../../jobs/events.js'
import { logger } from '../../lib/logger.js'
import { type IShift, Shift } from './shift.model.js'
import {
  currentRunningOccurrence,
  nextStartAfter,
  type ShiftLike,
} from './shift.utils.js'

type TimerRef = { start: NodeJS.Timeout | null; end: NodeJS.Timeout | null }

const timers = new Map<string, TimerRef>()
let running = false

function shiftPayload(shift: IShift) {
  return {
    shiftId: String(shift._id),
    name: shift.name,
    startHour: shift.startHour,
    startMinute: shift.startMinute,
    endHour: shift.endHour,
    endMinute: shift.endMinute,
  }
}

function clearTimersFor(id: string): void {
  const ref = timers.get(id)
  if (!ref) return
  if (ref.start) clearTimeout(ref.start)
  if (ref.end) clearTimeout(ref.end)
  timers.delete(id)
}

function rescheduleAfterFire(shiftId: unknown): void {
  void Shift.findById(shiftId).then(latest => {
    if (latest) scheduleFor(latest)
    else clearTimersFor(String(shiftId))
  })
}

/**
 * Set up boundary timers for one shift. Two independent paths:
 *
 * 1. CURRENT-OCCURRENCE END: if `currentRunningOccurrence` returns non-null,
 *    schedule ONLY this occurrence's `shift.ended` timer. Do NOT emit a
 *    synthetic `shift.started` for the past start — the "no missed-event
 *    backfill" rule applies. After the end fires, the chained reschedule
 *    will set up the next occurrence's timers from scratch.
 *
 * 2. STRICT-FUTURE NEXT START: always schedule the next start that is
 *    strictly in the future. When that start fires, the chained reschedule
 *    re-enters this function — at which point `currentRunningOccurrence`
 *    returns the just-started occurrence and path #1 schedules its end.
 */
function scheduleFor(shift: IShift): void {
  if (!running) return
  const id = String(shift._id)
  clearTimersFor(id)

  const now = new Date()
  const tz = config.PLANT_TIMEZONE
  const shiftLike = shift as unknown as ShiftLike

  const current = currentRunningOccurrence(shiftLike, now, tz)
  let endTimer: NodeJS.Timeout | null = null
  if (current) {
    const endDelay = Math.max(0, current.endedAt.getTime() - now.getTime())
    endTimer = setTimeout(() => {
      void emitShiftEnded({
        ...shiftPayload(shift),
        startedAt: current.startedAt,
        endedAt: current.endedAt,
        occurrenceDay: current.occurrenceDay,
      })
      rescheduleAfterFire(shift._id)
    }, endDelay)
  }

  const nextStart = nextStartAfter(shiftLike, now, tz)
  const startDelay = Math.max(0, nextStart.startedAt.getTime() - now.getTime())
  const startTimer = setTimeout(() => {
    void emitShiftStarted({
      ...shiftPayload(shift),
      startedAt: nextStart.startedAt,
      occurrenceDay: nextStart.occurrenceDay,
    })
    rescheduleAfterFire(shift._id)
  }, startDelay)

  timers.set(id, { start: startTimer, end: endTimer })
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function startShiftScheduler(): Promise<void> {
  if (running) return
  running = true
  logger.info('Starting shift scheduler', { event: 'shift.scheduler.start' })
  const all = await Shift.find().lean()
  for (const s of all) scheduleFor(s as IShift)
}

export async function stopShiftScheduler(): Promise<void> {
  running = false
  for (const id of Array.from(timers.keys())) clearTimersFor(id)
  logger.info('Shift scheduler stopped', { event: 'shift.scheduler.stop' })
}

export function onShiftCreated(shift: IShift): void {
  scheduleFor(shift)
}

export function onShiftUpdated(shift: IShift): void {
  scheduleFor(shift)
}

export function onShiftDeleted(shiftId: string): void {
  clearTimersFor(shiftId)
}
```

- [ ] **Step 13.4: Run the scheduler tests**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.scheduler.test.ts`
Expected: PASS (5 tests, including the mid-shift boot case). Fake timers advance setTimeout deterministically.

- [ ] **Step 13.5: Commit**

```bash
git add work-center/src/modules/shift/shift.scheduler.ts \
        work-center/src/modules/shift/__tests__/shift.scheduler.test.ts
git commit -m "feat(work-center/shift): in-process boundary scheduler with fake-timer tests"
```

---

## Task 14: Active-shift update rules (future/past end, start change)

**Files:**
- Modify: `work-center/src/modules/shift/shift.service.ts`
- Test: append to `work-center/src/modules/shift/__tests__/shift.service.test.ts`

- [ ] **Step 14.1: Write failing tests**

Append to `shift.service.test.ts`:

```typescript
describe('shift.service active-shift update rules', () => {
  beforeEach(async () => {
    await Shift.deleteMany({})
  })

  it('rejects end-time update moving end before now on the currently running occurrence (409)', async () => {
    // A shift whose current occurrence is in progress right now.
    // Freeze time to 2026-04-10 10:00 Istanbul; shift 08:00-16:00 is active.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T07:00:00.000Z'))
    const s = await shiftService.createShift(
      { name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    // Try to move end to 09:00 → in the past → reject
    await expect(
      shiftService.updateShift(String(s._id), { endHour: 9 }, userId),
    ).rejects.toMatchObject({ status: 409, message: 'shift.end_before_now' })
    vi.useRealTimers()
  })

  it('accepts end-time update moving end further into the future', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T07:00:00.000Z'))
    const s = await shiftService.createShift(
      { name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    const updated = await shiftService.updateShift(String(s._id), { endHour: 18 }, userId)
    expect(updated.endHour).toBe(18)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 14.2: Run the tests — expect failure**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.service.test.ts`
Expected: FAIL (missing `shift.end_before_now` guard)

- [ ] **Step 14.3: Add the active-occurrence guard to `updateShift`**

In `shift.service.ts` inside `updateShift`, after `assertValidTimeRange(proposed)` and before `assertReferencingAssignmentsRemainValid`, add:

```typescript
import { config } from '../../config/index.js'
import { currentRunningOccurrence, occurrenceEndOnDay } from './shift.utils.js'

// ...

// Active-occurrence guard: if the existing shift is currently running AND the
// caller is moving the end boundary, compute the proposed end on the SAME
// occurrenceDay (so we don't pick up tomorrow's start) and reject if it's not
// strictly in the future.
const endChanged = data.endHour !== undefined || data.endMinute !== undefined
const current = currentRunningOccurrence(existing, new Date(), config.PLANT_TIMEZONE)
if (endChanged && current) {
  const proposedEnd = occurrenceEndOnDay(
    proposed,
    current.occurrenceDay,
    config.PLANT_TIMEZONE,
  )
  if (proposedEnd.getTime() <= Date.now()) {
    throw new CustomError(409, 'shift.end_before_now')
  }
}
```

Start-boundary changes on a running shift are implicitly allowed — they take effect next occurrence because `scheduleFor(...)` reads the current time via `nextStartAfter`, which always returns a strictly future start. No extra logic needed.

- [ ] **Step 14.4: Run the tests to verify**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.service.test.ts`
Expected: PASS

- [ ] **Step 14.5: Commit**

```bash
git add work-center/src/modules/shift/shift.service.ts \
        work-center/src/modules/shift/__tests__/shift.service.test.ts
git commit -m "feat(work-center/shift): reject end-boundary edits moving end into the past on running occurrence"
```

---

## Task 15: Startup reconciliation (close stale check-ins on boot)

**Files:**
- Create: `work-center/src/modules/shift/shift.reconciliation.ts`
- Test: `work-center/src/modules/shift/__tests__/shift.reconciliation.test.ts`

- [ ] **Step 15.1: Write failing test**

Create `work-center/src/modules/shift/__tests__/shift.reconciliation.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import WorkCenter from '../../work-center/work-center.model.js'
import { Shift } from '../shift.model.js'
import { OperatorCheckIn } from '../../operators/operators.model.js'
import { DateException } from '../../schedule/schedule.model.js'
import { reconcileOpenCheckInsAtStartup } from '../shift.reconciliation.js'
import { emitOperatorCheckedOut } from '../../../jobs/events.js'

vi.mock('../../../jobs/events.js', () => ({
  emitOperatorCheckedOut: vi.fn(),
  emitOperatorCheckedIn: vi.fn(),
}))

const mockedEmit = vi.mocked(emitOperatorCheckedOut)
const userId = new Types.ObjectId().toHexString()

describe('reconcileOpenCheckInsAtStartup', () => {
  beforeEach(async () => {
    await Promise.all([
      WorkCenter.deleteMany({}),
      Shift.deleteMany({}),
      OperatorCheckIn.deleteMany({}),
      DateException.deleteMany({}),
    ])
    mockedEmit.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes a stale check-in at the missed shift-end boundary (single day shift)', async () => {
    // Europe/Istanbul. Day shift 08-16. checkedInAt 09:00 IST (06:00 UTC).
    // Now = 20:00 IST (17:00 UTC). Shift ended at 16:00 IST (13:00 UTC).
    // Reconciliation must close the check-in AT 13:00 UTC (the missed boundary),
    // not at `now`, so the operator isn't credited for hours after the shift end.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T17:00:00.000Z'))
    const s = await Shift.create({
      name: 'Day',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [s._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-10T06:00:00.000Z'), // 09:00 IST
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt?.toISOString()).toBe('2026-04-10T13:00:00.000Z')
    expect(after?.checkoutSource).toBe('shift_boundary')
    expect(mockedEmit).toHaveBeenCalledWith(
      String(wc._id),
      expect.any(String),
      String(ci._id),
      'shift_boundary',
    )
  })

  it('closes a stale check-in at the missed night→day rollover boundary', async () => {
    // Night 22-06 + Day 08-16 on the same WC. Operator checked in 23:00 IST
    // on 2026-04-09 during the night shift. Service was down 06:00 → 08:10 IST
    // on 2026-04-10. Boot at 08:10 IST (= 05:10 UTC). The day shift IS currently
    // running, but the night shift's end at 06:00 IST (03:00 UTC) was MISSED
    // — the check-in must close at 03:00 UTC, not "stay open because day is
    // currently running".
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T05:10:00.000Z'))
    const night = await Shift.create({
      name: 'Night',
      startHour: 22,
      startMinute: 0,
      endHour: 6,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const day = await Shift.create({
      name: 'Day',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [night._id, day._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-09T20:00:00.000Z'), // 23:00 IST
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
    const after = await OperatorCheckIn.findById(ci._id)
    // Closed at 06:00 IST 2026-04-10 = 03:00 UTC (the missed night-shift end)
    expect(after?.checkedOutAt?.toISOString()).toBe('2026-04-10T03:00:00.000Z')
    expect(after?.checkoutSource).toBe('shift_boundary')
  })

  it('leaves a check-in alone when the SAME occurrence is still running', async () => {
    // Day shift 08-16. checkedInAt 08:30 IST. Boot at 11:00 IST. Same
    // occurrence is still running and no boundary was missed → no-op.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T08:00:00.000Z')) // 11:00 IST
    const s = await Shift.create({
      name: 'Day',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [s._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-10T05:30:00.000Z'), // 08:30 IST
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt).toBeNull()
  })

  it('closes check-ins on work centers with no effective schedule (source=none)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T10:00:00.000Z'))
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-09T10:00:00.000Z'),
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
    const after = await OperatorCheckIn.findById(ci._id)
    // No missed boundary and no current shift → close at `now`.
    expect(after?.checkedOutAt?.toISOString()).toBe('2026-04-10T10:00:00.000Z')
  })

  it('caps the lookback for very old check-ins (safety limit)', async () => {
    // checkedInAt is 30 days old → scanFrom is capped to 14 days back. The
    // check-in must still be closed (no current shift), but we never iterate
    // years of schedule.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T17:00:00.000Z'))
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-03-11T10:00:00.000Z'), // 30 days ago
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
  })

  it('does not fan a shift across days where it is not scheduled (phantom-shift)', async () => {
    // Regression for the "unique shift collected across range" bug.
    //
    // WC has `shiftIds: [Day 08-16]` by default. Two past days (2026-04-08,
    // 2026-04-09) have DateExceptions with `shiftIds: []` (plant closed).
    // Operator checked in on 2026-04-08 at 10:00 IST (07:00 UTC) but the
    // plant was closed that day — there were no shifts scheduled at all.
    //
    // Today is 2026-04-10 14:00 IST (11:00 UTC). The Day shift is currently
    // running, but the check-in started on 2026-04-08 — BEFORE today's
    // occurrence's startedAt (08:00 IST today = 05:00 UTC). So the check-in
    // does NOT belong to the current running occurrence and must be closed
    // at `now`. Critically, it must NOT be closed at a phantom past-day
    // boundary (2026-04-08T13:00Z) — that boundary never existed because
    // the Day shift was not scheduled on 2026-04-08.
    //
    // Two bugs this test guards against:
    // 1. Unique-shift fan-out: collecting `Day` from today's schedule and
    //    computing phantom end boundaries on closed past days.
    // 2. Loose stillRunning: "any shift running today → leave alone" ignoring
    //    that the check-in predates the current occurrence.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T11:00:00.000Z')) // 14:00 IST
    const day = await Shift.create({
      name: 'Day',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [day._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    // Past days closed via DateException with empty shiftIds.
    await DateException.create({
      workCenterId: wc._id,
      localDate: '2026-04-08',
      shiftIds: [],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await DateException.create({
      workCenterId: wc._id,
      localDate: '2026-04-09',
      shiftIds: [],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-08T07:00:00.000Z'), // 10:00 IST day-2
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
    const after = await OperatorCheckIn.findById(ci._id)
    // Closed at `now` — NOT at a phantom 2026-04-08T13:00Z boundary.
    expect(after?.checkedOutAt?.toISOString()).toBe('2026-04-10T11:00:00.000Z')
    expect(after?.checkoutSource).toBe('shift_boundary')
  })

  it('leaves an overnight occurrence alone when it is still running', async () => {
    // Night shift 22-06 scheduled on WC by default. Today (2026-04-10 in IST)
    // has a DateException with shiftIds=[] (no shifts today). But yesterday's
    // (2026-04-09) night occurrence started at 22:00 IST = 19:00 UTC and ends
    // at 06:00 IST = 03:00 UTC. Now = 02:00 IST 2026-04-10 (= 2026-04-09T23:00Z).
    // The occurrence is still running AND the check-in started inside it →
    // leave alone.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T23:00:00.000Z')) // 02:00 IST 2026-04-10
    const night = await Shift.create({
      name: 'Night',
      startHour: 22,
      startMinute: 0,
      endHour: 6,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [night._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    // Today in IST (2026-04-10) is closed — but yesterday's overnight occurrence
    // is still running at 02:00 IST.
    await DateException.create({
      workCenterId: wc._id,
      localDate: '2026-04-10',
      shiftIds: [],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-09T20:00:00.000Z'), // 23:00 IST 2026-04-09
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt).toBeNull()
    expect(mockedEmit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 15.2: Run test — expect failure**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.reconciliation.test.ts`
Expected: FAIL

- [ ] **Step 15.3: Implement reconciliation**

Create `work-center/src/modules/shift/shift.reconciliation.ts`:

```typescript
import { Types } from 'mongoose'
import { config } from '../../config/index.js'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { emitOperatorCheckedOut } from '../../jobs/events.js'
import { logger } from '../../lib/logger.js'
import { OperatorCheckIn } from '../operators/operators.model.js'
import { getEffectiveSchedule } from '../schedule/schedule.service.js'
import {
  computeOccurrenceDay,
  currentRunningOccurrence,
  occurrenceEndOnDay,
  type ShiftLike,
} from './shift.utils.js'

const RECONCILIATION_MAX_LOOKBACK_DAYS = 14

/**
 * Startup sweep that closes stale operator check-ins after downtime.
 *
 * Algorithm (per open check-in), strictly day-scoped:
 *
 * 1. Determine scan range: `max(checkedInAt, now - 14d)` → `now`. The cap
 *    prevents runaway scans on ancient records.
 * 2. Walk every plant-local day from `scanFrom`'s local day (minus one for
 *    overnight back-coverage) through today inclusive. For each day:
 *    a. Read `getEffectiveSchedule(wcId, day)` AT CALL TIME (no snapshot).
 *    b. For every shift listed in THAT day's schedule, compute its end
 *       boundary on THAT day only via `occurrenceEndOnDay(shift, day, tz)`.
 *       This is the (shift, occurrenceDay) pair that was actually scheduled
 *       — not a phantom of the shift fanned out across the whole range.
 *    c. If the boundary falls in `(scanFrom, now]`, it's a candidate.
 * 3. Pick the EARLIEST candidate boundary across all days.
 *    - If one exists → close the check-in at that boundary's `endedAt`
 *      (operator was idle from then on; metrics shouldn't credit them past).
 *    - If none exist → check whether the check-in belongs to a currently-
 *      running scheduled occurrence. Walk [yesterday, today] effective
 *      schedules and for each shift call `currentRunningOccurrence`. The
 *      occurrence must be scheduled on its own `occurrenceDay` (not a
 *      phantom) AND `startedAt <= checkedInAt < endedAt` (the check-in
 *      was made inside that occurrence's window).
 *    - If such an occurrence exists → leave the check-in alone.
 *    - Otherwise → close at `now` (stale floating check-in).
 *
 * This is NOT event replay — no historical events are read. The decision
 * uses only the *current* schedule state and the check-in's `checkedInAt`.
 */
export async function reconcileOpenCheckInsAtStartup(): Promise<string[]> {
  const now = new Date()
  const tz = config.PLANT_TIMEZONE
  const today = computeOccurrenceDay(now, tz)
  const openCheckIns = await OperatorCheckIn.find({ checkedOutAt: null })
  const closedCheckInIds: string[] = []

  // Cache effective schedules per (workCenterId, day) to avoid redundant calls.
  const effCache = new Map<string, Awaited<ReturnType<typeof getEffectiveSchedule>>>()
  const getEff = async (wcId: string, day: string) => {
    const key = `${wcId}|${day}`
    let eff = effCache.get(key)
    if (!eff) {
      eff = await getEffectiveSchedule(wcId, day)
      effCache.set(key, eff)
    }
    return eff
  }

  for (const ci of openCheckIns) {
    const wcId = String(ci.workCenterId)
    const checkedInAt = ci.checkedInAt
    if (!checkedInAt) continue

    // Cap the lookback so very old open check-ins don't trigger month-long scans.
    const cap = new Date(now.getTime() - RECONCILIATION_MAX_LOOKBACK_DAYS * 24 * 3600 * 1000)
    const scanFrom = checkedInAt.getTime() < cap.getTime() ? cap : checkedInAt

    // Day-scoped walk. Each (shift, day) pair is evaluated independently —
    // a shift only appearing in today's schedule produces NO candidates for
    // earlier days. Back the start up by one day so overnight occurrences
    // assigned to the day before scanFrom whose end falls inside the range
    // are still considered.
    let earliestMissedEnd: Date | null = null
    const firstDay = computeOccurrenceDay(scanFrom, tz)
    let walkDay = addLocalDay(firstDay, -1)
    while (walkDay <= today) {
      const eff = await getEff(wcId, walkDay)
      for (const s of eff.shifts) {
        const shiftLike = s as unknown as ShiftLike
        const endedAt = occurrenceEndOnDay(shiftLike, walkDay, tz)
        if (
          endedAt.getTime() > scanFrom.getTime() &&
          endedAt.getTime() <= now.getTime() &&
          (earliestMissedEnd === null || endedAt.getTime() < earliestMissedEnd.getTime())
        ) {
          earliestMissedEnd = endedAt
        }
      }
      walkDay = addLocalDay(walkDay, 1)
    }

    let closeAt: Date | null = null
    if (earliestMissedEnd) {
      closeAt = earliestMissedEnd
    } else {
      // No missed boundary — leave the check-in alone ONLY if it belongs to a
      // currently-running scheduled occurrence. "Belongs to" means the check-in
      // was made WITHIN that occurrence's [startedAt, endedAt) window AND the
      // occurrence is actually scheduled on its day (not a phantom).
      // Walk yesterday + today so overnight shifts starting yesterday are covered.
      let leaveAlone = false
      const yesterday = addLocalDay(today, -1)
      const daysToCheck = [yesterday, today]
      outer: for (const checkDay of daysToCheck) {
        const eff = await getEff(wcId, checkDay)
        for (const s of eff.shifts) {
          const shiftLike = s as unknown as ShiftLike
          const running = currentRunningOccurrence(shiftLike, now, tz)
          if (!running) continue
          // Occurrence must be scheduled on its own day — not a phantom.
          if (running.occurrenceDay !== checkDay) continue
          // Check-in must fall inside this occurrence's window.
          if (
            running.startedAt.getTime() <= checkedInAt.getTime() &&
            checkedInAt.getTime() < running.endedAt.getTime()
          ) {
            leaveAlone = true
            break outer
          }
        }
      }
      if (!leaveAlone) closeAt = now
    }

    if (!closeAt) continue

    ci.checkedOutAt = closeAt
    ci.checkoutSource = 'shift_boundary'
    ci.updatedBy = new Types.ObjectId(SYSTEM_IDENTITY)
    await ci.save()
    await emitOperatorCheckedOut(wcId, String(ci.operatorId), String(ci._id), 'shift_boundary')
    closedCheckInIds.push(String(ci._id))
  }

  logger.info('Startup reconciliation completed', {
    event: 'shift.reconciliation.completed',
    openScanned: openCheckIns.length,
    closedCount: closedCheckInIds.length,
  })
  return closedCheckInIds
}

function addLocalDay(yyyyMmDd: string, delta: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number) as [number, number, number]
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + delta)
  const yy = base.getUTCFullYear()
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(base.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
```

- [ ] **Step 15.4: Run tests**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.reconciliation.test.ts`
Expected: PASS (7 tests, including night→day rollover, lookback cap, phantom-shift regression, and overnight still-running cases)

- [ ] **Step 15.5: Commit**

```bash
git add work-center/src/modules/shift/shift.reconciliation.ts \
        work-center/src/modules/shift/__tests__/shift.reconciliation.test.ts
git commit -m "feat(work-center/shift): startup reconciliation closes stale check-ins"
```

---

## Task 16: Bootstrap — start scheduler + run reconciliation

**Files:**
- Modify: `work-center/src/core/loaders/index.ts`
- Modify: `work-center/src/app.ts`

- [ ] **Step 16.1: Wire the scheduler and reconciliation into `initLoaders`**

Replace `work-center/src/core/loaders/index.ts` body with:

```typescript
import { initSubscribers } from '../../jobs/subscribers.js'
import { logger } from '../../lib/logger.js'
import { initRedis } from '../../lib/redis.js'
import { reconcileOpenCheckInsAtStartup } from '../../modules/shift/shift.reconciliation.js'
import { startShiftScheduler } from '../../modules/shift/shift.scheduler.js'
import { initExpress } from './express.js'
import { initMongoose } from './mongoose.js'

export const initLoaders = async () => {
  try {
    logger.info('Initializing application loaders', { event: 'loader.init.started' })

    await initMongoose()
    await initRedis()
    await initSubscribers()

    // Startup reconciliation must run BEFORE the scheduler starts firing boundary
    // events, so stale check-ins are closed against current state.
    await reconcileOpenCheckInsAtStartup()
    await startShiftScheduler()

    const app = await initExpress()

    logger.info('All loaders initialized successfully', { event: 'loader.init.completed' })
    return app
  } catch (error) {
    logger.error('Loader initialization failed', {
      event: 'loader.init.failed',
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    process.exit(1)
  }
}
```

- [ ] **Step 16.2: Stop the scheduler on shutdown**

In `work-center/src/app.ts`, add the import:

```typescript
import { stopShiftScheduler } from './modules/shift/shift.scheduler.js'
```

And include `stopShiftScheduler()` in the shutdown `Promise.all`:

```typescript
await Promise.all([
  disconnectDB(),
  closeRedis(),
  shutdownSubscribers(),
  stopShiftScheduler(),
])
```

- [ ] **Step 16.3: Run typecheck**

Run: `cd work-center && pnpm typecheck`
Expected: PASS

- [ ] **Step 16.4: Commit**

```bash
git add work-center/src/core/loaders/index.ts work-center/src/app.ts
git commit -m "feat(work-center): wire shift scheduler and startup reconciliation into bootstrap"
```

---

## Task 17: Production service — internal shift references endpoint

**Files:**
- Create: `production/src/modules/internal/shift-references.routes.ts`
- Modify: `production/src/core/loaders/express.ts`

- [ ] **Step 17.1: Create the endpoint**

```typescript
import type { Request, Response } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { validateParams } from '../../core/middleware/validate.js'
import { objectIdSchema } from '../../utils/validators.js'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'

const shiftIdParamSchema = z.object({ id: objectIdSchema })

const router = Router()

router.get(
  '/shifts/:id/references',
  validateParams(shiftIdParamSchema),
  async (req: Request<{ id: string }>, res: Response) => {
    const shiftId = req.params.id
    const [qa, scrap] = await Promise.all([
      QuantityAdjustment.countDocuments({ shiftId }),
      ScrapEntry.countDocuments({ shiftId }),
    ])
    res.json({ data: { inUse: qa + scrap > 0 } })
  },
)

export default router
```

- [ ] **Step 17.2: Mount it in production express loader**

In `production/src/core/loaders/express.ts`, import and mount on the internal router:

```typescript
import shiftReferencesRoutes from '../../modules/internal/shift-references.routes.js'

// inside the internal router setup, alongside work-center-references:
internalRouter.use(shiftReferencesRoutes)
```

(The exact name of the internal router variable matches what already exists in the file; add the `use` next to the work-center references mount.)

- [ ] **Step 17.3: Add an integration test for the endpoint**

Create `production/src/modules/internal/shift-references.test.ts`:

```typescript
import request from 'supertest'
import { Types } from 'mongoose'
import { describe, expect, it, beforeEach } from 'vitest'
import { initExpress } from '../../core/loaders/express.js'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'

describe('GET /internal/v1/shifts/:id/references', () => {
  beforeEach(async () => {
    await Promise.all([QuantityAdjustment.deleteMany({}), ScrapEntry.deleteMany({})])
  })

  it('returns inUse=false when no references', async () => {
    const app = await initExpress()
    const shiftId = new Types.ObjectId().toHexString()
    const res = await request(app).get(`/internal/v1/shifts/${shiftId}/references`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ inUse: false })
  })

  it('returns inUse=true when a QuantityAdjustment references the shift', async () => {
    const app = await initExpress()
    const shiftId = new Types.ObjectId()
    await QuantityAdjustment.create({
      workCenterId: new Types.ObjectId(),
      jobOrderId: new Types.ObjectId(),
      shiftId,
      delta: 1,
      reason: 'test',
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
    })
    const res = await request(app).get(`/internal/v1/shifts/${shiftId.toHexString()}/references`)
    expect(res.body.data.inUse).toBe(true)
  })
})
```

Note: match the fields above to the actual `QuantityAdjustment` schema — if extra required fields exist, add them. Use whatever minimum-required shape is needed to pass schema validation.

- [ ] **Step 17.4: Run the test**

Run: `cd production && pnpm test src/modules/internal/shift-references.test.ts`
Expected: PASS

- [ ] **Step 17.5: Commit**

```bash
git add production/src/modules/internal/shift-references.routes.ts \
        production/src/modules/internal/shift-references.test.ts \
        production/src/core/loaders/express.ts
git commit -m "feat(production/internal): expose /shifts/:id/references for delete guard"
```

---

## Task 18: Production service — sync shift existence validation on create/update

**Files:**
- Modify: `production/src/config/index.ts`
- Modify: `production/src/lib/internal-api.ts`
- Modify: `production/src/modules/quantity-adjustment/quantity-adjustment.service.ts`
- Modify: `production/src/modules/scrap-entry/scrap-entry.service.ts`
- Modify: `production/.env.example`
- Modify: `production/vitest.config.ts`

- [ ] **Step 18.1: Add `INTERNAL_API_WORK_CENTER` to production env**

In `production/src/config/index.ts`, add to the Zod schema (next to other INTERNAL_API_* entries):

```typescript
INTERNAL_API_WORK_CENTER: z
  .string()
  .trim()
  .min(1, 'INTERNAL_API_WORK_CENTER must be provided')
  .pipe(z.url()),
```

Add it to `production/.env.example`:

```
INTERNAL_API_WORK_CENTER=http://localhost:3001
```

And to `production/vitest.config.ts` under `env:`:

```typescript
INTERNAL_API_WORK_CENTER: 'http://localhost:3001',
```

- [ ] **Step 18.2: Add `validateShiftExists` to production internal API**

In `production/src/lib/internal-api.ts`, add:

```typescript
const WORK_CENTER_API = config.INTERNAL_API_WORK_CENTER

async function fetchWorkCenter(path: string): Promise<Response> {
  return fetch(`${WORK_CENTER_API}/internal/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Validate that a shift exists in work-center service.
 * Throws CustomError(400) if not found. Fails closed (throws) if work-center
 * is unreachable — a production write cannot proceed without confirmation.
 */
export async function assertShiftExists(shiftId: string): Promise<void> {
  try {
    const res = await fetchWorkCenter(`/shifts/${shiftId}`)
    if (res.status === 404) {
      throw new CustomError(400, 'production.shift_not_found', { shiftId })
    }
    if (!res.ok) {
      throw new CustomError(503, 'production.work_center_unreachable')
    }
  } catch (err) {
    if (err instanceof CustomError) throw err
    logger.warn('work-center unreachable for shift validation', {
      event: 'internal_api.work_center.shift_validation_unreachable',
      shiftId,
      error: err instanceof Error ? err.message : err,
    })
    throw new CustomError(503, 'production.work_center_unreachable')
  }
}
```

Import `CustomError` at the top if not already imported.

- [ ] **Step 18.3: Call `assertShiftExists` in quantity-adjustment + scrap-entry services**

In `quantity-adjustment.service.ts`, inside `createQuantityAdjustment` and `updateQuantityAdjustment` (where a `shiftId` is present on the input), add:

```typescript
import { assertShiftExists } from '../../lib/internal-api.js'

// before Mongoose .save() / findOneAndUpdate:
if (data.shiftId) await assertShiftExists(String(data.shiftId))
```

Repeat the same in `scrap-entry.service.ts`.

- [ ] **Step 18.4: Add a test that mocks internal-api and asserts rejection**

Add to `quantity-adjustment.service.test.ts` (or create a new focused file if cleaner):

```typescript
import { vi } from 'vitest'

vi.mock('../../lib/internal-api.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    assertShiftExists: vi.fn().mockResolvedValue(undefined),
  }
})

// ... in a test:
it('rejects create when shift does not exist in work-center', async () => {
  const { assertShiftExists } = await import('../../lib/internal-api.js')
  vi.mocked(assertShiftExists).mockRejectedValueOnce(
    Object.assign(new Error('not found'), { status: 400, message: 'production.shift_not_found' }),
  )
  await expect(
    service.createQuantityAdjustment(
      { shiftId: new Types.ObjectId().toHexString(), /* other required fields */ },
      new Types.ObjectId().toHexString(),
    ),
  ).rejects.toMatchObject({ status: 400 })
})
```

- [ ] **Step 18.5: Run production tests**

Run: `cd production && pnpm test`
Expected: PASS

- [ ] **Step 18.6: Commit**

```bash
git add production/src/config/index.ts \
        production/src/lib/internal-api.ts \
        production/src/modules/quantity-adjustment/quantity-adjustment.service.ts \
        production/src/modules/scrap-entry/scrap-entry.service.ts \
        production/.env.example \
        production/vitest.config.ts
git commit -m "feat(production): synchronous shift existence validation via work-center internal API"
```

---

## Task 19: Shift routes integration tests

**Files:**
- Create: `work-center/src/modules/shift/__tests__/shift.routes.test.ts`

- [ ] **Step 19.1: Write supertest-based integration tests**

```typescript
import request from 'supertest'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initExpress } from '../../../core/loaders/express.js'
import { Shift } from '../shift.model.js'

vi.mock('../../../jobs/events.js', () => ({
  emitShiftCreated: vi.fn(),
  emitShiftUpdated: vi.fn(),
  emitShiftDeleted: vi.fn(),
  emitShiftStarted: vi.fn(),
  emitShiftEnded: vi.fn(),
  emitScheduleChanged: vi.fn(),
  emitOperatorCheckedIn: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
  emitWorkCenterCreated: vi.fn(),
  emitWorkCenterUpdated: vi.fn(),
  emitWorkCenterArchived: vi.fn(),
  emitWorkCenterReactivated: vi.fn(),
  emitWorkCenterDeleted: vi.fn(),
  emitHierarchyChanged: vi.fn(),
  emitMetricCompositionChanged: vi.fn(),
  emitActionStateChanged: vi.fn(),
}))
vi.mock('../shift.scheduler.js', () => ({
  onShiftCreated: vi.fn(),
  onShiftUpdated: vi.fn(),
  onShiftDeleted: vi.fn(),
  startShiftScheduler: vi.fn(),
  stopShiftScheduler: vi.fn(),
}))
vi.mock('../../../lib/internal-api.js', () => ({
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
  addWorkCenterToUser: vi.fn(),
  isWorkCenterReferencedByUsers: vi.fn().mockResolvedValue(false),
  validateOperatorExists: vi.fn().mockResolvedValue(true),
}))

describe('shift routes (internal)', () => {
  beforeEach(async () => {
    await Shift.deleteMany({})
  })

  it('POST /internal/v1/shifts creates a shift', async () => {
    const app = await initExpress()
    const res = await request(app)
      .post('/internal/v1/shifts')
      .send({ name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 })
    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Day')
  })

  it('GET /internal/v1/shifts returns the list', async () => {
    const app = await initExpress()
    await request(app)
      .post('/internal/v1/shifts')
      .send({ name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 })
    const res = await request(app).get('/internal/v1/shifts')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('DELETE /internal/v1/shifts/:id works when no references', async () => {
    const app = await initExpress()
    const create = await request(app)
      .post('/internal/v1/shifts')
      .send({ name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 })
    const id = create.body.data._id
    const del = await request(app).delete(`/internal/v1/shifts/${id}`)
    expect(del.status).toBe(200)
  })

  it('GET /internal/v1/shifts/:id returns 404 for unknown id', async () => {
    const app = await initExpress()
    const res = await request(app).get(`/internal/v1/shifts/${new Types.ObjectId().toHexString()}`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 19.2: Run the tests**

Run: `cd work-center && pnpm test src/modules/shift/__tests__/shift.routes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 19.3: Commit**

```bash
git add work-center/src/modules/shift/__tests__/shift.routes.test.ts
git commit -m "test(work-center/shift): integration tests for shift routes"
```

---

## Task 20: Update work-center-spec.md and production-service-spec.md

**Files:**
- Modify: `work-center-spec.md`
- Modify: `docs/production-service-spec.md`

- [ ] **Step 20.1: Update `work-center-spec.md`**

Replace any language that refers to shifts as being owned by an external service or as an "opaque reference". The shift module is now owned by work-center-service. Add a short "Shift module" section pointing to `docs/work-center-shift-module-spec.md` for the full decisions. Concretely, add the following section after the existing "Schedule" section:

```markdown
## Shift module

- The `shift` module inside `work-center` owns a global shift catalog.
- Schedules reference shifts by id — no embedded intervals.
- Boundary scheduling is handled in-process by the work-center service.
- Runtime boundary events (`work_center.shift.started`, `work_center.shift.ended`) are published on `events.work_center`.
- Auto check-out of operators on shift end is driven by the `work_center.shift.ended` event. See `docs/work-center-shift-module-spec.md` for full detail.
```

Also remove or reword any remaining "external shift service" phrases.

- [ ] **Step 20.2: Update `docs/production-service-spec.md`**

In the section that defines `QuantityAdjustment` and `ScrapEntry`, update the `shiftId` prose:

- Remove "external shift service / opaque reference" language.
- State: "`shiftId` references `work-center-service.Shift` — production must validate shift existence via `GET /internal/v1/shifts/:id` on write paths (create/update)."
- Add a "Delete guard" note: "Production exposes `GET /internal/v1/shifts/:id/references` so work-center can block shift delete when any `QuantityAdjustment` or `ScrapEntry` references the shift."

- [ ] **Step 20.3: Commit**

```bash
git add work-center-spec.md docs/production-service-spec.md
git commit -m "docs: align work-center and production specs with shift module ownership"
```

---

## Task 21: Full-suite regression + final verification

**Files:** none (verification only)

- [ ] **Step 21.1: Run the whole test suite for work-center and production**

Run: `cd work-center && pnpm typecheck && pnpm test`
Expected: PASS

Run: `cd production && pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 21.2: Run root-level turbo test to catch cross-package drift**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 21.3: Run lint on all changed files**

Run: `pnpm lint`
Expected: no errors

- [ ] **Step 21.4: Manual sanity — boot the stack and hit the endpoints**

```bash
docker compose up -d --build work-center production user
```

Then:
- `curl http://localhost/api/v1/shifts` (via gateway with a valid token) — should return `{ data: [] }`
- POST a shift, GET it back, PATCH its name, then DELETE it — all should succeed
- Create a shift, assign it to a work center (`PATCH /api/v1/work-centers/:id { shiftIds: [...] }`), wait for its next boundary to fire, check logs for `shift.scheduler.fire` and `operators.auto_checkout.shift_ended`.

- [ ] **Step 21.5: Final commit if any lint/format fixes**

```bash
git add -A
git commit -m "chore: post-implementation formatting and lint cleanup" || echo "nothing to commit"
```

---

# Spec Coverage Map

| Spec section | Covered by |
|---|---|
| Shift CRUD inside work-center | Task 3, 4, 5, 6 |
| Shift runtime scheduler | Task 13, 16 |
| Schedule model refactor | Task 7, 8 |
| Operator auto check-out on shift.ended | Task 11, 12 |
| Delete reference checks (work-center + production) | Task 5, 17 |
| Production spec alignment | Task 17, 18, 20 |
| `checkoutSource` field | Task 10 |
| `PLANT_TIMEZONE` env | Task 1 |
| Global unique name (case-insensitive) | Task 3 (index), Task 4 (service assert) |
| Invalid time (start==end) | Task 2 (util), Task 4 (service) |
| Overlap at assignment points (WC, Calendar day, Exception) | Task 2, 8, 9 |
| Shift time update affected-assignment re-validation | Task 5 |
| 00:00 normalization | Task 2 |
| Active shift update rules | Task 14 |
| CRUD + Boundary event payloads | Task 4 (CRUD), Task 13 (Boundary) |
| Occurrence day semantics | Task 2, 13 |
| Scheduler rules (restart, update/delete, no duplicates) | Task 13 |
| Operator auto check-out flow | Task 11 |
| Multi-work-center check-in preserved | Task 11 (per-workCenter logic) |
| checkoutSource in operator.checked_out event | Task 10 |
| Check-in shiftId filtering | Task 11 (works from effective schedule, ignores ci.shiftId) |
| `DateException.localDate` date-only string | Task 7 |
| Instant vs date-only semantics | Task 7 (localDate), Task 4 (event serialization) |
| Minimum API routes | Task 6 |
| Permissions read/writeSchedules | Task 6 |
| Production sync shift validation | Task 18 |
| Production delete guard endpoint | Task 17 |
| Production spec language alignment | Task 20 |
| All minimum tests | Task 2, 4, 5, 8, 9, 10, 11, 13, 14, 15, 19 |
| **Startup reconciliation (no replay)** | Task 15, 16 |
| **Schedule mutations allowed during running shift** | No guard added — covered implicitly by Task 8 (no active-shift check) |
| **Effective schedule resolved at event processing time** | Task 8 (`resolveAffectedWorkCenters`), Task 11 (consumer call), Task 15 (reconciliation) |

# Anti-goals Verified

- [x] No archive status for shifts — not in the model
- [x] No dangling shiftId references — enforced by delete guards in Task 5, 17
- [x] No per-work-center boundary event fan-out — scheduler emits one event, consumer resolves
- [x] No shared global config package migration — each service validates its own env
- [x] No `system` value for `checkoutSource` — enum has only `manual | shift_boundary`
