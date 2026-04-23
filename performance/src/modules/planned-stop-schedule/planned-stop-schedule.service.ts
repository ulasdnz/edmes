import { CustomError } from '@mes/core'
import { Types } from 'mongoose'
import {
  emitPlannedStopScheduleCreated,
  emitPlannedStopScheduleDeleted,
  emitPlannedStopScheduleUpdated,
} from '../../jobs/events.js'
import { Reason } from '../reason/reason.model.js'
import {
  type DayOfWeek,
  type IPlannedStopSchedule,
  type OccurrenceStartMode,
  PlannedStopSchedule,
  type RecurrenceFrequency,
} from './planned-stop-schedule.model.js'

export interface RecurrenceInput {
  frequency: RecurrenceFrequency
  daysOfWeek?: DayOfWeek[]
  timezone: string
  startHour: number
  startMinute: number
}

export interface CreateScheduleInput {
  workCenterIds?: string[]
  reasonId: string
  plannedOwnerId: string
  name: string
  description?: string
  occurrenceStartMode: OccurrenceStartMode
  recurrence: RecurrenceInput
  plannedDurationMs: number
  createBeforeStartMs?: number
  isEnabled?: boolean
  props?: Record<string, unknown>
}

export interface UpdateScheduleInput {
  workCenterIds?: string[]
  reasonId?: string
  plannedOwnerId?: string
  name?: string
  description?: string | null
  occurrenceStartMode?: OccurrenceStartMode
  recurrence?: RecurrenceInput
  plannedDurationMs?: number
  createBeforeStartMs?: number
  isEnabled?: boolean
  props?: Record<string, unknown>
}

export interface ScheduleListInput {
  workCenterId?: string
  reasonId?: string
  isEnabled?: boolean
}

function toObjectIds(ids: string[]): Types.ObjectId[] {
  return ids.map(id => new Types.ObjectId(id))
}

async function assertReasonAllowsScheduled(reasonId: Types.ObjectId): Promise<void> {
  const reason = await Reason.findById(reasonId)
    .select({ canBeScheduled: 1, isActive: 1, usages: 1 })
    .lean()
  if (!reason) throw new CustomError(404, 'error.reason_not_found')
  if (!reason.isActive) throw new CustomError(400, 'error.reason_inactive')
  if (!reason.canBeScheduled) throw new CustomError(400, 'error.reason_cannot_be_scheduled')
  if (!reason.usages?.includes('planned_stop')) {
    throw new CustomError(400, 'error.reason_usage_mismatch')
  }
}

function validateRecurrence(r: RecurrenceInput): void {
  if (r.startHour < 0 || r.startHour > 23) {
    throw new CustomError(400, 'error.schedule_invalid_hour')
  }
  if (r.startMinute < 0 || r.startMinute > 59) {
    throw new CustomError(400, 'error.schedule_invalid_minute')
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: r.timezone })
  } catch {
    throw new CustomError(400, 'error.schedule_invalid_timezone')
  }
  if (r.frequency === 'weekly' && (!r.daysOfWeek || r.daysOfWeek.length === 0)) {
    throw new CustomError(400, 'error.schedule_weekly_requires_days')
  }
}

export async function create(
  data: CreateScheduleInput,
  userId: string,
): Promise<IPlannedStopSchedule> {
  if (data.plannedDurationMs < 1) {
    throw new CustomError(400, 'error.schedule_invalid_duration')
  }
  validateRecurrence(data.recurrence)
  await assertReasonAllowsScheduled(new Types.ObjectId(data.reasonId))

  const doc = await PlannedStopSchedule.create({
    workCenterIds: data.workCenterIds ? toObjectIds(data.workCenterIds) : [],
    reasonId: new Types.ObjectId(data.reasonId),
    plannedOwnerId: new Types.ObjectId(data.plannedOwnerId),
    name: data.name,
    description: data.description ?? null,
    occurrenceStartMode: data.occurrenceStartMode,
    recurrence: data.recurrence,
    plannedDurationMs: data.plannedDurationMs,
    createBeforeStartMs: data.createBeforeStartMs,
    isEnabled: data.isEnabled ?? true,
    props: data.props,
    createdBy: new Types.ObjectId(userId),
  })
  emitPlannedStopScheduleCreated(doc._id.toString())
  return doc
}

export async function getById(id: string): Promise<IPlannedStopSchedule> {
  const doc = await PlannedStopSchedule.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IPlannedStopSchedule
}

export async function list(input: ScheduleListInput): Promise<IPlannedStopSchedule[]> {
  const query: Record<string, unknown> = {}
  if (input.workCenterId) query.workCenterIds = new Types.ObjectId(input.workCenterId)
  if (input.reasonId) query.reasonId = new Types.ObjectId(input.reasonId)
  if (input.isEnabled !== undefined) query.isEnabled = input.isEnabled

  return PlannedStopSchedule.find(query)
    .sort({ name: 1 })
    .select('-__v')
    .lean<IPlannedStopSchedule[]>()
}

export async function update(
  id: string,
  data: UpdateScheduleInput,
  userId: string,
): Promise<IPlannedStopSchedule> {
  const existing = await PlannedStopSchedule.findById(id).select({ _id: 1 }).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')

  const $set: Record<string, unknown> = { updatedBy: new Types.ObjectId(userId) }

  if (data.workCenterIds !== undefined) {
    $set.workCenterIds = toObjectIds(data.workCenterIds)
  }
  if (data.reasonId !== undefined) {
    await assertReasonAllowsScheduled(new Types.ObjectId(data.reasonId))
    $set.reasonId = new Types.ObjectId(data.reasonId)
  }
  if (data.plannedOwnerId !== undefined) {
    $set.plannedOwnerId = new Types.ObjectId(data.plannedOwnerId)
  }
  if (data.name !== undefined) $set.name = data.name
  if (data.description !== undefined) $set.description = data.description
  if (data.occurrenceStartMode !== undefined) {
    $set.occurrenceStartMode = data.occurrenceStartMode
  }
  if (data.recurrence !== undefined) {
    validateRecurrence(data.recurrence)
    $set.recurrence = data.recurrence
  }
  if (data.plannedDurationMs !== undefined) {
    if (data.plannedDurationMs < 1) {
      throw new CustomError(400, 'error.schedule_invalid_duration')
    }
    $set.plannedDurationMs = data.plannedDurationMs
  }
  if (data.createBeforeStartMs !== undefined) {
    if (data.createBeforeStartMs < 0) {
      throw new CustomError(400, 'error.schedule_invalid_lead_time')
    }
    $set.createBeforeStartMs = data.createBeforeStartMs
  }
  if (data.isEnabled !== undefined) $set.isEnabled = data.isEnabled
  if (data.props !== undefined) $set.props = data.props

  const doc = await PlannedStopSchedule.findOneAndUpdate(
    { _id: id },
    { $set },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitPlannedStopScheduleUpdated(doc._id.toString())
  return doc
}

export async function remove(id: string): Promise<IPlannedStopSchedule> {
  const doc = await PlannedStopSchedule.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitPlannedStopScheduleDeleted(doc._id.toString())
  return doc
}

export async function listEnabled(): Promise<IPlannedStopSchedule[]> {
  return PlannedStopSchedule.find({ isEnabled: true }).lean<IPlannedStopSchedule[]>()
}
