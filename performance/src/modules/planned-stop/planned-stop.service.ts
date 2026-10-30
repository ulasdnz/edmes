import { CustomError } from '@mes/core'
import { type PaginatedResult, paginate } from '@mes/core/pagination'
import { Types } from 'mongoose'
import {
  emitPlannedStopCancelled,
  emitPlannedStopClosed,
  emitPlannedStopCreated,
  emitPlannedStopDeleted,
  emitPlannedStopStarted,
  emitPlannedStopUpdated,
} from '../../jobs/events.js'
import { getLatest } from '../../lib/internal-api/run-mode-telemetry.client.js'
import { getById as getWorkCenter } from '../../lib/internal-api/work-center.client.js'
import { Reason } from '../reason/reason.model.js'
import {
  closeIfOpen as closeOpenUnplanned,
  openFromRunMode as openUnplannedFromRunMode,
} from '../unplanned-stop/unplanned-stop.service.js'
import { type IPlannedStop, PlannedStop } from './planned-stop.model.js'

export interface CreatePlannedStopInput {
  workCenterId: string
  reasonId: string
  plannedOwnerId: string
  plannedStartAt: Date
  plannedEndAt: Date
  actualStartAt?: Date
  actualEndAt?: Date
  status?: 'planned' | 'closed'
  startMode?: 'automatic' | 'manual'
  source?: 'manual' | 'converted' | 'template' | 'scheduled'
  templateId?: string
  scheduleId?: string
  description?: string
  props?: Record<string, unknown>
}

export interface UpdatePlannedStopInput {
  reasonId?: string
  plannedOwnerId?: string
  plannedStartAt?: Date
  plannedEndAt?: Date
  description?: string | null
  props?: Record<string, unknown>
}

export interface ClosePlannedStopInput {
  actualEndAt?: Date
  description?: string
}

export interface PlannedStopListInput {
  page?: number
  limit?: number
  sort?: string
  workCenterId?: string
  accessibleWorkCenterIds?: string[]
  status?: 'planned' | 'active' | 'closed' | 'cancelled'
  reasonId?: string
  from?: Date
  to?: Date
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
}

async function assertNoOverlap(
  workCenterId: Types.ObjectId,
  plannedStartAt: Date,
  plannedEndAt: Date,
  excludeId?: Types.ObjectId,
): Promise<void> {
  const filter: Record<string, unknown> = {
    workCenterId,
    status: { $ne: 'cancelled' },
    plannedStartAt: { $lt: plannedEndAt },
    plannedEndAt: { $gt: plannedStartAt },
  }
  if (excludeId) filter._id = { $ne: excludeId }
  const clash = await PlannedStop.exists(filter)
  if (clash) throw new CustomError(409, 'error.planned_stop_overlap')
}

async function assertReasonAllows(
  reasonId: Types.ObjectId,
  field: 'canStartManually' | 'canBeScheduled' | 'canConvertFromUnplanned',
): Promise<void> {
  const reason = await Reason.findById(reasonId)
    .select({ [field]: 1, isActive: 1, usages: 1 })
    .lean()
  if (!reason) throw new CustomError(404, 'error.reason_not_found')
  if (!reason.isActive) throw new CustomError(400, 'error.reason_inactive')
  if (!reason[field]) throw new CustomError(400, `error.reason_${field}_denied`)
  if (!reason.usages?.includes('planned_stop')) {
    throw new CustomError(400, 'error.reason_usage_mismatch')
  }
}

export async function create(data: CreatePlannedStopInput, userId: string): Promise<IPlannedStop> {
  if (data.plannedEndAt <= data.plannedStartAt) {
    throw new CustomError(400, 'error.planned_stop_invalid_window')
  }
  const wcObjectId = new Types.ObjectId(data.workCenterId)
  const reasonObjectId = new Types.ObjectId(data.reasonId)
  await assertReasonAllows(reasonObjectId, 'canStartManually')

  await assertNoOverlap(wcObjectId, data.plannedStartAt, data.plannedEndAt)

  const status = data.status ?? 'planned'
  if (status === 'closed') {
    if (!data.actualStartAt || !data.actualEndAt) {
      throw new CustomError(400, 'error.planned_stop_closed_requires_actuals')
    }
    if (data.actualEndAt <= data.actualStartAt) {
      throw new CustomError(400, 'error.planned_stop_invalid_actual_window')
    }
  }

  try {
    const doc = await PlannedStop.create({
      workCenterId: wcObjectId,
      reasonId: reasonObjectId,
      plannedOwnerId: new Types.ObjectId(data.plannedOwnerId),
      source: data.source ?? 'manual',
      startMode: data.startMode ?? 'manual',
      status,
      plannedStartAt: data.plannedStartAt,
      plannedEndAt: data.plannedEndAt,
      actualStartAt: data.actualStartAt ?? null,
      actualEndAt: data.actualEndAt ?? null,
      templateId: data.templateId ? new Types.ObjectId(data.templateId) : null,
      scheduleId: data.scheduleId ? new Types.ObjectId(data.scheduleId) : null,
      description: data.description ?? null,
      props: data.props,
      createdBy: new Types.ObjectId(userId),
    })
    emitPlannedStopCreated(doc._id.toString(), data.workCenterId)
    return doc
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new CustomError(409, 'error.planned_stop_active_exists')
    }
    throw err
  }
}

export async function getById(id: string): Promise<IPlannedStop> {
  const doc = await PlannedStop.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IPlannedStop
}

export async function list(input: PlannedStopListInput): Promise<PaginatedResult<IPlannedStop>> {
  const { page = 1, limit = 20, sort, from, to, ...filters } = input

  const query: Record<string, unknown> = {}
  if (filters.workCenterId) {
    query.workCenterId = new Types.ObjectId(filters.workCenterId)
  } else if (filters.accessibleWorkCenterIds) {
    query.workCenterId = { $in: filters.accessibleWorkCenterIds.map(id => new Types.ObjectId(id)) }
  }
  if (filters.reasonId) query.reasonId = new Types.ObjectId(filters.reasonId)
  if (filters.status) query.status = filters.status

  if (from || to) {
    const range: Record<string, Date> = {}
    if (from) range.$gte = from
    if (to) range.$lte = to
    query.plannedStartAt = range
  }

  return paginate(
    PlannedStop,
    query,
    { page, limit, sort },
    {
      allowedSortFields: [
        'plannedStartAt',
        'plannedEndAt',
        'actualStartAt',
        'actualEndAt',
        'createdAt',
        'updatedAt',
      ],
    },
  )
}

export async function update(
  id: string,
  data: UpdatePlannedStopInput,
  userId: string,
): Promise<IPlannedStop> {
  const existing = await PlannedStop.findById(id).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')

  const $set: Record<string, unknown> = { updatedBy: new Types.ObjectId(userId) }

  if (data.reasonId !== undefined) {
    const reasonObjectId = new Types.ObjectId(data.reasonId)
    await assertReasonAllows(reasonObjectId, 'canStartManually')
    $set.reasonId = reasonObjectId
  }
  if (data.plannedOwnerId !== undefined) {
    $set.plannedOwnerId = new Types.ObjectId(data.plannedOwnerId)
  }
  if (data.description !== undefined) $set.description = data.description
  if (data.props !== undefined) $set.props = data.props

  const windowTouched = data.plannedStartAt !== undefined || data.plannedEndAt !== undefined
  if (windowTouched) {
    if (existing.status !== 'planned') {
      throw new CustomError(400, 'error.planned_stop_window_locked')
    }
    const nextStart = data.plannedStartAt ?? existing.plannedStartAt
    const nextEnd = data.plannedEndAt ?? existing.plannedEndAt
    if (nextEnd <= nextStart) {
      throw new CustomError(400, 'error.planned_stop_invalid_window')
    }
    await assertNoOverlap(existing.workCenterId, nextStart, nextEnd, existing._id)
    $set.plannedStartAt = nextStart
    $set.plannedEndAt = nextEnd
  }

  const doc = await PlannedStop.findOneAndUpdate(
    { _id: id },
    { $set },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitPlannedStopUpdated(doc._id.toString(), doc.workCenterId.toString())
  return doc
}

export async function start(
  id: string,
  userId: string,
  options: { actualStartAt?: Date } = {},
): Promise<IPlannedStop> {
  const existing = await PlannedStop.findById(id)
  if (!existing) throw new CustomError(404, 'error.not_found')
  if (existing.status === 'cancelled') {
    throw new CustomError(400, 'error.planned_stop_cancelled')
  }
  if (existing.status === 'active') return existing
  if (existing.status === 'closed') {
    throw new CustomError(400, 'error.planned_stop_already_closed')
  }

  const workCenterId = existing.workCenterId
  const actualStartAt = options.actualStartAt ?? new Date()

  await closeOpenUnplanned(workCenterId.toString(), actualStartAt, { closedBy: userId })

  try {
    const updated = await PlannedStop.findOneAndUpdate(
      { _id: id, status: 'planned' },
      {
        $set: {
          status: 'active',
          actualStartAt,
          actualEndAt: null,
          operatorId: new Types.ObjectId(userId),
          updatedBy: new Types.ObjectId(userId),
        },
      },
      { returnDocument: 'after', runValidators: true },
    )
    if (!updated) throw new CustomError(409, 'error.planned_stop_state_conflict')
    emitPlannedStopStarted(updated._id.toString(), workCenterId.toString())
    return updated
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new CustomError(409, 'error.planned_stop_active_exists')
    }
    throw err
  }
}

export async function close(
  id: string,
  data: ClosePlannedStopInput,
  userId: string,
): Promise<IPlannedStop> {
  const existing = await PlannedStop.findById(id).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')
  if (existing.status !== 'active') {
    throw new CustomError(400, 'error.planned_stop_not_active')
  }

  const actualEndAt = data.actualEndAt ?? new Date()
  if (existing.actualStartAt && actualEndAt <= existing.actualStartAt) {
    throw new CustomError(400, 'error.planned_stop_invalid_actual_window')
  }

  const $set: Record<string, unknown> = {
    status: 'closed',
    actualEndAt,
    closedBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  }
  if (data.description !== undefined) $set.description = data.description

  const doc = await PlannedStop.findOneAndUpdate(
    { _id: id, status: 'active' },
    { $set },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(409, 'error.planned_stop_state_conflict')

  await maybeOpenUnplannedAfterClose(doc, actualEndAt)

  emitPlannedStopClosed(doc._id.toString(), doc.workCenterId.toString())
  return doc
}

async function maybeOpenUnplannedAfterClose(
  closed: IPlannedStop,
  actualEndAt: Date,
): Promise<void> {
  const workCenterId = closed.workCenterId.toString()

  const covering = await PlannedStop.exists({
    workCenterId: closed.workCenterId,
    _id: { $ne: closed._id },
    status: { $in: ['planned', 'active'] },
    plannedStartAt: { $lte: actualEndAt },
    plannedEndAt: { $gt: actualEndAt },
  })
  if (covering) return

  const wc = await getWorkCenter(workCenterId)
  const runModeTagId = wc?.tagBindings?.runModeTagId
  if (!runModeTagId) return

  const latest = await getLatest(runModeTagId)
  if (!latest) return
  if (latest.value >= 1) return

  await openUnplannedFromRunMode(workCenterId, actualEndAt)
}

export async function cancel(id: string, userId: string): Promise<IPlannedStop> {
  const existing = await PlannedStop.findById(id).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')
  if (existing.status !== 'planned') {
    throw new CustomError(400, 'error.planned_stop_not_cancellable')
  }

  const doc = await PlannedStop.findOneAndUpdate(
    { _id: id, status: 'planned' },
    {
      $set: {
        status: 'cancelled',
        updatedBy: new Types.ObjectId(userId),
      },
    },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(409, 'error.planned_stop_state_conflict')
  emitPlannedStopCancelled(doc._id.toString(), doc.workCenterId.toString())
  return doc
}

export async function remove(id: string): Promise<IPlannedStop> {
  const existing = await PlannedStop.findById(id).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')
  if (existing.status === 'active') {
    throw new CustomError(400, 'error.planned_stop_active_cannot_delete')
  }

  const doc = await PlannedStop.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitPlannedStopDeleted(doc._id.toString(), doc.workCenterId.toString())
  return doc
}
