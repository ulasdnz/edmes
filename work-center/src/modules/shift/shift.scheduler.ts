import { config } from '../../config/index.js'
import { emitShiftEnded, emitShiftStarted } from '../../jobs/events.js'
import { logger } from '../../lib/logger.js'
import { type IShift, Shift } from './shift.model.js'
import { currentRunningOccurrence, nextStartAfter, type ShiftLike } from './shift.utils.js'

type TimerRef = { start: NodeJS.Timeout | null; end: NodeJS.Timeout | null }

const timers = new Map<string, TimerRef>()
const shiftCache = new Map<string, IShift>()
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
  shiftCache.set(id, shift)
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
      const cached = shiftCache.get(id)
      if (cached) scheduleFor(cached)
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
    const cached = shiftCache.get(id)
    if (cached) scheduleFor(cached)
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
  shiftCache.clear()
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
  shiftCache.delete(shiftId)
}
