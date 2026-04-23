import { Types } from 'mongoose'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { logger } from '../../lib/logger.js'
import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import { start as startPlannedStop } from '../planned-stop/planned-stop.service.js'
import { type IPlannedStopSchedule, PlannedStopSchedule } from './planned-stop-schedule.model.js'
import { nextOccurrenceAfter } from './planned-stop-schedule.recurrence.js'

const timers = new Map<string, NodeJS.Timeout>()
let running = false

function clearTimerFor(id: string): void {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

async function materialize(
  schedule: IPlannedStopSchedule,
  plannedStartAt: Date,
  plannedEndAt: Date,
): Promise<void> {
  if (schedule.workCenterIds.length === 0) return

  for (const wcId of schedule.workCenterIds) {
    try {
      await PlannedStop.create({
        workCenterId: wcId,
        reasonId: schedule.reasonId,
        plannedOwnerId: schedule.plannedOwnerId,
        source: 'scheduled',
        startMode: schedule.occurrenceStartMode,
        status: 'planned',
        plannedStartAt,
        plannedEndAt,
        scheduleId: schedule._id,
        description: schedule.description ?? null,
        createdBy: new Types.ObjectId(SYSTEM_IDENTITY),
      })
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
        continue
      }
      logger.warn('Failed to materialize scheduled planned stop', {
        event: 'planned_stop.scheduler.materialize_failed',
        scheduleId: schedule._id.toString(),
        workCenterId: wcId.toString(),
        error: err instanceof Error ? err.message : err,
      })
      continue
    }

    if (schedule.occurrenceStartMode === 'automatic' && plannedStartAt <= new Date()) {
      const just = await PlannedStop.findOne({
        scheduleId: schedule._id,
        workCenterId: wcId,
        plannedStartAt,
      })
        .select({ _id: 1 })
        .lean()
      if (just) {
        try {
          await startPlannedStop(just._id.toString(), SYSTEM_IDENTITY, {
            actualStartAt: new Date(),
          })
        } catch (err) {
          logger.warn('Failed to auto-start scheduled planned stop', {
            event: 'planned_stop.scheduler.autostart_failed',
            scheduleId: schedule._id.toString(),
            plannedStopId: just._id.toString(),
            error: err instanceof Error ? err.message : err,
          })
        }
      }
    }
  }
}

function scheduleFor(schedule: IPlannedStopSchedule): void {
  if (!running) return
  const id = schedule._id.toString()
  clearTimerFor(id)
  if (!schedule.isEnabled) return

  const next = nextOccurrenceAfter(schedule, new Date())
  if (!next) return

  const leadMs = schedule.createBeforeStartMs ?? 15 * 60 * 1000
  const fireAt = next.plannedStartAt.getTime() - leadMs
  const delay = Math.max(0, fireAt - Date.now())

  const timer = setTimeout(() => {
    void (async () => {
      try {
        await materialize(schedule, next.plannedStartAt, next.plannedEndAt)
      } finally {
        const latest = await PlannedStopSchedule.findById(schedule._id).lean()
        if (latest?.isEnabled) scheduleFor(latest as IPlannedStopSchedule)
      }
    })()
  }, delay)

  timers.set(id, timer)
}

export async function startPlannedStopScheduler(): Promise<void> {
  if (running) return
  running = true
  logger.info('Starting planned stop scheduler', { event: 'planned_stop.scheduler.start' })
  const schedules = await PlannedStopSchedule.find({ isEnabled: true }).lean<
    IPlannedStopSchedule[]
  >()
  for (const s of schedules) scheduleFor(s)
}

export async function stopPlannedStopScheduler(): Promise<void> {
  running = false
  for (const id of Array.from(timers.keys())) clearTimerFor(id)
  logger.info('Planned stop scheduler stopped', { event: 'planned_stop.scheduler.stop' })
}

export function onScheduleCreated(schedule: IPlannedStopSchedule): void {
  scheduleFor(schedule)
}

export function onScheduleUpdated(schedule: IPlannedStopSchedule): void {
  scheduleFor(schedule)
}

export function onScheduleDeleted(scheduleId: string): void {
  clearTimerFor(scheduleId)
}

export const __test__ = { materialize, timers }
