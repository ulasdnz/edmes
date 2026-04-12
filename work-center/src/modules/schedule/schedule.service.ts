import { Types } from 'mongoose'
import { CustomError } from '../../core/errors/index.js'
import { emitScheduleChanged } from '../../jobs/events.js'
import { type IShift, Shift } from '../shift/shift.model.js'
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
    const pattern = calendar.weeklyPattern as unknown as Record<
      DayOfWeek,
      Array<string | { toString(): string }>
    >
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
  const docs = (await Shift.find({ _id: { $in: ids } })
    .select('-__v')
    .lean()) as IShift[]
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
