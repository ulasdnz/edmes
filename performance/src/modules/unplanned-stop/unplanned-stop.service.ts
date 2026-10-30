import { CustomError } from '@mes/core'
import { type PaginatedResult, paginate } from '@mes/core/pagination'
import { Types } from 'mongoose'
import {
  emitUnplannedStopClosed,
  emitUnplannedStopConverted,
  emitUnplannedStopOpened,
  emitUnplannedStopUpdated,
} from '../../jobs/events.js'
import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import { resolveForWorkCenter } from '../policy/policy.service.js'
import { Reason } from '../reason/reason.model.js'
import { getSystemReasonIdByCode } from '../reason/reason.service.js'
import { type IUnplannedStop, UnplannedStop } from './unplanned-stop.model.js'

export interface CreateManualUnplannedStopInput {
  workCenterId: string
  startAt: Date
  endAt?: Date
  reasonId?: string
  description?: string
}

export interface CloseUnplannedStopInput {
  endAt?: Date
  reasonId?: string
  description?: string
}

export interface ConvertToPlannedInput {
  plannedStopId?: string
  reasonId?: string
  plannedOwnerId?: string
  description?: string
}

export interface PatchUnplannedStopInput {
  reasonId?: string | null
  description?: string | null
  approvedAt?: Date | null
  approvedBy?: string | null
  props?: Record<string, unknown>
}

export interface UnplannedStopListInput {
  page?: number
  limit?: number
  sort?: string
  workCenterId?: string
  accessibleWorkCenterIds?: string[]
  state?: 'open' | 'closed' | 'converted'
  from?: Date
  to?: Date
  reasonId?: string
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
}

export async function openFromRunMode(
  workCenterId: string,
  startAt: Date,
): Promise<IUnplannedStop> {
  const wcObjectId = new Types.ObjectId(workCenterId)
  try {
    const doc = await UnplannedStop.create({
      workCenterId: wcObjectId,
      source: 'run_mode',
      startAt,
    })
    emitUnplannedStopOpened(doc._id.toString(), workCenterId)
    return doc
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const existing = await UnplannedStop.findOne({
        workCenterId: wcObjectId,
        endAt: null,
      })
      if (existing) return existing
    }
    throw err
  }
}

export async function closeIfOpen(
  workCenterId: string,
  endAt: Date,
  options: { closedBy?: string } = {},
): Promise<IUnplannedStop | null> {
  const wcObjectId = new Types.ObjectId(workCenterId)
  const update: Record<string, unknown> = { endAt }
  if (options.closedBy) update.closedBy = new Types.ObjectId(options.closedBy)

  const closed = await UnplannedStop.findOneAndUpdate(
    { workCenterId: wcObjectId, endAt: null },
    { $set: update },
    { returnDocument: 'after' },
  )
  if (!closed) return null

  if (!closed.reasonId) {
    const policy = await resolveForWorkCenter(workCenterId)
    const durationMs = closed.endAt!.getTime() - closed.startAt.getTime()
    if (durationMs <= policy.microStopThresholdMs) {
      const microStopReasonId = await getSystemReasonIdByCode('MICRO_STOP')
      const tagged = await UnplannedStop.findOneAndUpdate(
        { _id: closed._id, reasonId: null },
        { $set: { reasonId: microStopReasonId } },
        { returnDocument: 'after' },
      )
      if (tagged) {
        emitUnplannedStopClosed(tagged._id.toString(), workCenterId)
        return tagged
      }
    }
  }

  emitUnplannedStopClosed(closed._id.toString(), workCenterId)
  return closed
}

export async function createManual(
  data: CreateManualUnplannedStopInput,
  userId: string,
): Promise<IUnplannedStop> {
  const wcObjectId = new Types.ObjectId(data.workCenterId)
  if (data.endAt && data.endAt <= data.startAt) {
    throw new CustomError(400, 'error.unplanned_stop_invalid_interval')
  }
  const userObjectId = new Types.ObjectId(userId)
  try {
    const doc = await UnplannedStop.create({
      workCenterId: wcObjectId,
      source: 'manual',
      startAt: data.startAt,
      endAt: data.endAt ?? null,
      reasonId: data.reasonId ? new Types.ObjectId(data.reasonId) : null,
      description: data.description ?? null,
      operatorId: userObjectId,
      createdBy: userObjectId,
      closedBy: data.endAt ? userObjectId : null,
    })
    emitUnplannedStopOpened(doc._id.toString(), data.workCenterId)
    if (data.endAt) {
      emitUnplannedStopClosed(doc._id.toString(), data.workCenterId)
    }
    return doc
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new CustomError(409, 'error.unplanned_stop_already_open')
    }
    throw err
  }
}

export async function getById(id: string): Promise<IUnplannedStop> {
  const doc = await UnplannedStop.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IUnplannedStop
}

export async function list(
  input: UnplannedStopListInput,
): Promise<PaginatedResult<IUnplannedStop>> {
  const { page = 1, limit = 20, sort, state, from, to, ...filters } = input

  const query: Record<string, unknown> = {}
  if (filters.workCenterId) {
    query.workCenterId = new Types.ObjectId(filters.workCenterId)
  } else if (filters.accessibleWorkCenterIds) {
    query.workCenterId = { $in: filters.accessibleWorkCenterIds.map(id => new Types.ObjectId(id)) }
  }
  if (filters.reasonId) query.reasonId = new Types.ObjectId(filters.reasonId)

  if (state === 'open') query.endAt = null
  else if (state === 'closed') {
    query.endAt = { $ne: null }
    query.convertedToPlannedStopId = null
  } else if (state === 'converted') {
    query.convertedToPlannedStopId = { $ne: null }
  }

  if (from || to) {
    const range: Record<string, Date> = {}
    if (from) range.$gte = from
    if (to) range.$lte = to
    query.startAt = range
  }

  return paginate(
    UnplannedStop,
    query,
    { page, limit, sort },
    { allowedSortFields: ['startAt', 'endAt', 'createdAt', 'updatedAt'] },
  )
}

export async function close(
  id: string,
  data: CloseUnplannedStopInput,
  userId: string,
): Promise<IUnplannedStop> {
  const existing = await UnplannedStop.findById(id).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')
  if (existing.endAt) throw new CustomError(409, 'error.unplanned_stop_already_closed')

  const update: Record<string, unknown> = {
    endAt: data.endAt ?? new Date(),
    closedBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  }
  if (data.reasonId !== undefined) update.reasonId = new Types.ObjectId(data.reasonId)
  if (data.description !== undefined) update.description = data.description

  const doc = await UnplannedStop.findOneAndUpdate(
    { _id: id, endAt: null },
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(409, 'error.unplanned_stop_already_closed')

  if (!doc.reasonId) {
    const policy = await resolveForWorkCenter(doc.workCenterId.toString())
    const durationMs = doc.endAt!.getTime() - doc.startAt.getTime()
    if (durationMs <= policy.microStopThresholdMs) {
      const microStopReasonId = await getSystemReasonIdByCode('MICRO_STOP')
      const tagged = await UnplannedStop.findOneAndUpdate(
        { _id: doc._id, reasonId: null },
        { $set: { reasonId: microStopReasonId } },
        { returnDocument: 'after' },
      )
      if (tagged) {
        emitUnplannedStopClosed(tagged._id.toString(), doc.workCenterId.toString())
        return tagged
      }
    }
  }

  emitUnplannedStopClosed(doc._id.toString(), doc.workCenterId.toString())
  return doc
}

export async function convertToPlanned(
  id: string,
  data: ConvertToPlannedInput,
  userId: string,
): Promise<IUnplannedStop> {
  const existing = await UnplannedStop.findById(id)
  if (!existing) throw new CustomError(404, 'error.not_found')
  if (existing.convertedToPlannedStopId) {
    throw new CustomError(409, 'error.unplanned_stop_already_converted')
  }

  const reasonId = data.reasonId ? new Types.ObjectId(data.reasonId) : (existing.reasonId ?? null)
  if (!reasonId) throw new CustomError(400, 'error.reason_required')

  const reason = await Reason.findById(reasonId).select({ canConvertFromUnplanned: 1 }).lean()
  if (!reason) throw new CustomError(404, 'error.reason_not_found')
  if (!reason.canConvertFromUnplanned) {
    throw new CustomError(400, 'error.reason_cannot_convert')
  }

  const endAt = existing.endAt ?? new Date()
  let plannedStopObjectId: Types.ObjectId

  if (data.plannedStopId) {
    const target = await PlannedStop.findById(data.plannedStopId).select({ workCenterId: 1 }).lean()
    if (!target) throw new CustomError(404, 'error.planned_stop_not_found')
    if (target.workCenterId.toString() !== existing.workCenterId.toString()) {
      throw new CustomError(400, 'error.conversion_work_center_mismatch')
    }
    plannedStopObjectId = target._id
  } else {
    const owner = data.plannedOwnerId
      ? new Types.ObjectId(data.plannedOwnerId)
      : new Types.ObjectId(userId)
    const created = await PlannedStop.create({
      workCenterId: existing.workCenterId,
      reasonId,
      plannedOwnerId: owner,
      source: 'converted',
      startMode: 'manual',
      status: 'closed',
      plannedStartAt: existing.startAt,
      plannedEndAt: endAt,
      actualStartAt: existing.startAt,
      actualEndAt: endAt,
      description: data.description ?? existing.description ?? null,
      createdBy: new Types.ObjectId(userId),
    })
    plannedStopObjectId = created._id
  }

  const update: Record<string, unknown> = {
    convertedToPlannedStopId: plannedStopObjectId,
    reasonId,
    updatedBy: new Types.ObjectId(userId),
  }
  if (!existing.endAt) update.endAt = endAt

  const doc = await UnplannedStop.findOneAndUpdate(
    { _id: id, convertedToPlannedStopId: null },
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(409, 'error.unplanned_stop_already_converted')

  emitUnplannedStopConverted(
    doc._id.toString(),
    doc.workCenterId.toString(),
    plannedStopObjectId.toString(),
  )
  return doc
}

export async function patch(
  id: string,
  data: PatchUnplannedStopInput,
  userId: string,
): Promise<IUnplannedStop> {
  const existing = await UnplannedStop.findById(id).select({ _id: 1 }).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')

  const $set: Record<string, unknown> = { updatedBy: new Types.ObjectId(userId) }
  if (data.reasonId !== undefined) {
    $set.reasonId = data.reasonId ? new Types.ObjectId(data.reasonId) : null
  }
  if (data.description !== undefined) $set.description = data.description
  if (data.approvedAt !== undefined) $set.approvedAt = data.approvedAt
  if (data.approvedBy !== undefined) {
    $set.approvedBy = data.approvedBy ? new Types.ObjectId(data.approvedBy) : null
  }
  if (data.props !== undefined) $set.props = data.props

  const doc = await UnplannedStop.findOneAndUpdate(
    { _id: id },
    { $set },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitUnplannedStopUpdated(doc._id.toString(), doc.workCenterId.toString())
  return doc
}

export async function remove(id: string, _userId: string): Promise<IUnplannedStop> {
  const doc = await UnplannedStop.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitUnplannedStopUpdated(doc._id.toString(), doc.workCenterId.toString())
  return doc
}
