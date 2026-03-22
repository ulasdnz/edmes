import { CustomError } from '../../core/errors/index.js'
import { emitScheduleChanged } from '../../jobs/events.js'
import WorkCenter from '../work-center/work-center.model.js'
import { Calendar, DateException, type ICalendar, type IDateException } from './schedule.model.js'
import type {
  CreateCalendarInput,
  PatchCalendarInput,
  UpsertExceptionInput,
} from './schedule.validators.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertWorkCenterActive(workCenterId: string) {
  const wc = await WorkCenter.findById(workCenterId).select('_id status').lean()
  if (!wc) throw new CustomError(404, 'work_center.not_found')
  if (wc.status !== 'active') throw new CustomError(400, 'work_center.must_be_active')
}

async function assertNoOverlap(
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

// ── Calendar CRUD ───────────────────────────────────────────────────────────

export async function createCalendar(
  workCenterId: string,
  data: CreateCalendarInput,
  userId: string,
): Promise<ICalendar> {
  await assertWorkCenterActive(workCenterId)
  await assertNoOverlap(workCenterId, data.validFrom, data.validTo)

  const doc = new Calendar({
    ...data,
    workCenterId,
    createdBy: userId,
    updatedBy: userId,
  })
  const saved = await doc.save()
  await emitScheduleChanged(workCenterId)
  return saved
}

export async function getCalendar(workCenterId: string, calendarId: string): Promise<ICalendar> {
  const cal = await Calendar.findOne({ _id: calendarId, workCenterId }).lean()
  if (!cal) throw new CustomError(404, 'schedule.calendar_not_found')
  return cal as ICalendar
}

export async function getCalendars(workCenterId: string): Promise<ICalendar[]> {
  return Calendar.find({ workCenterId }).sort({ validFrom: -1 }).lean() as Promise<ICalendar[]>
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
  await assertNoOverlap(workCenterId, data.validFrom, data.validTo, calendarId)

  Object.assign(existing, data)
  existing.updatedBy = userId
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

  await assertWorkCenterActive(workCenterId)

  // Status change (active ↔ retired)
  if (data.status && data.status !== existing.status) {
    existing.status = data.status
  }

  // Business field updates require active calendar status
  const { status, ...businessFields } = data
  if (Object.keys(businessFields).length > 0) {
    if (existing.status !== 'active') {
      throw new CustomError(400, 'work_center.must_be_active')
    }

    const finalValidFrom = businessFields.validFrom ?? existing.validFrom
    const finalValidTo = businessFields.validTo ?? existing.validTo

    if (finalValidFrom >= finalValidTo) {
      throw new CustomError(400, 'schedule.valid_from_before_valid_to')
    }

    if (businessFields.validFrom || businessFields.validTo) {
      await assertNoOverlap(workCenterId, finalValidFrom, finalValidTo, calendarId)
    }

    for (const [key, value] of Object.entries(businessFields)) {
      ;(existing as unknown as Record<string, unknown>)[key] = value
    }
  }

  existing.updatedBy = userId
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

  const dateObj = new Date(localDate + 'T00:00:00.000Z')

  const doc = await DateException.findOneAndUpdate(
    { workCenterId, localDate: dateObj },
    {
      $set: {
        intervals: data.intervals,
        updatedBy: userId,
      },
      $setOnInsert: {
        workCenterId,
        localDate: dateObj,
        createdBy: userId,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  )

  await emitScheduleChanged(workCenterId)
  return doc!
}

export async function deleteException(workCenterId: string, localDate: string): Promise<void> {
  const dateObj = new Date(localDate + 'T00:00:00.000Z')
  const result = await DateException.deleteOne({ workCenterId, localDate: dateObj })
  if (result.deletedCount === 0) throw new CustomError(404, 'schedule.exception_not_found')
  await emitScheduleChanged(workCenterId)
}

// ── Effective schedule ──────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

export async function getEffectiveSchedule(workCenterId: string, date: string) {
  const wc = await WorkCenter.findById(workCenterId).select('_id shiftIds').lean()
  if (!wc) throw new CustomError(404, 'work_center.not_found')

  const dateObj = new Date(date + 'T00:00:00.000Z')

  // 1. DateException — highest priority
  const exception = await DateException.findOne({ workCenterId, localDate: dateObj }).lean()
  if (exception) {
    return { source: 'exception' as const, date, intervals: exception.intervals }
  }

  // 2. Active calendar covering the date
  const calendar = await Calendar.findOne({
    workCenterId,
    status: 'active',
    validFrom: { $lte: dateObj },
    validTo: { $gte: dateObj },
  }).lean()

  if (calendar) {
    const dayOfWeek = DAYS_OF_WEEK[dateObj.getUTCDay()]
    const pattern = calendar.weeklyPattern as unknown as Record<string, unknown[]>
    const intervals = pattern[dayOfWeek] ?? []
    return { source: 'calendar' as const, date, calendarId: String(calendar._id), intervals }
  }

  // 3. Fallback to shiftIds
  if (wc.shiftIds && wc.shiftIds.length > 0) {
    return { source: 'shiftIds' as const, date, shiftIds: wc.shiftIds.map(String) }
  }

  // 4. No match = empty (day closed)
  return { source: 'none' as const, date, intervals: [] }
}

// ── Helpers for lifecycle guards (used by work-center service) ──────────────

export async function hasActiveCalendars(workCenterId: string): Promise<boolean> {
  const count = await Calendar.countDocuments({ workCenterId, status: 'active' })
  return count > 0
}
