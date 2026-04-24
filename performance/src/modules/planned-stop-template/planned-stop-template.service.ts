import { CustomError } from '@mes/core'
import { Types } from 'mongoose'
import {
  emitPlannedStopCreated,
  emitPlannedStopStarted,
  emitPlannedStopTemplateCreated,
  emitPlannedStopTemplateDeleted,
  emitPlannedStopTemplateUpdated,
} from '../../jobs/events.js'
import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import { close as closePlannedStop } from '../planned-stop/planned-stop.service.js'
import { Reason } from '../reason/reason.model.js'
import {
  closeIfOpen as closeOpenUnplanned,
  createManual as createManualUnplanned,
} from '../unplanned-stop/unplanned-stop.service.js'
import {
  type IPlannedStopTemplate,
  type OverrunPolicy,
  PlannedStopTemplate,
} from './planned-stop-template.model.js'

export interface CreatePlannedStopTemplateInput {
  workCenterIds?: string[]
  reasonId: string
  name: string
  description?: string
  defaultDurationMs: number
  plannedOwnerId?: string
  responsibleUserId?: string
  overrunPolicy: OverrunPolicy
  overrunReasonId?: string
  isActive?: boolean
  props?: Record<string, unknown>
}

export interface UpdatePlannedStopTemplateInput {
  workCenterIds?: string[]
  reasonId?: string
  name?: string
  description?: string | null
  defaultDurationMs?: number
  plannedOwnerId?: string | null
  responsibleUserId?: string | null
  overrunPolicy?: OverrunPolicy
  overrunReasonId?: string | null
  isActive?: boolean
  props?: Record<string, unknown>
}

export interface TemplateListInput {
  workCenterId?: string
  reasonId?: string
  isActive?: boolean
}

export interface StartFromTemplateInput {
  workCenterId: string
  actualStartAt?: Date
  description?: string
  plannedDurationMs?: number
}

function toObjectIds(ids: string[]): Types.ObjectId[] {
  return ids.map(id => new Types.ObjectId(id))
}

async function assertReasonCompatible(
  reasonId: Types.ObjectId,
  kind: 'planned' | 'unplanned',
): Promise<void> {
  const reason = await Reason.findById(reasonId).select({ usages: 1, isActive: 1 }).lean()
  if (!reason) throw new CustomError(404, 'error.reason_not_found')
  if (!reason.isActive) throw new CustomError(400, 'error.reason_inactive')
  const required = kind === 'planned' ? 'planned_stop' : 'unplanned_stop'
  if (!reason.usages?.includes(required)) {
    throw new CustomError(400, 'error.reason_usage_mismatch')
  }
}

export async function create(
  data: CreatePlannedStopTemplateInput,
  userId: string,
): Promise<IPlannedStopTemplate> {
  if (data.defaultDurationMs < 1) {
    throw new CustomError(400, 'error.planned_stop_template_invalid_duration')
  }
  await assertReasonCompatible(new Types.ObjectId(data.reasonId), 'planned')
  if (data.overrunReasonId) {
    await assertReasonCompatible(new Types.ObjectId(data.overrunReasonId), 'unplanned')
  }

  const doc = await PlannedStopTemplate.create({
    workCenterIds: data.workCenterIds ? toObjectIds(data.workCenterIds) : [],
    reasonId: new Types.ObjectId(data.reasonId),
    name: data.name,
    description: data.description ?? null,
    defaultDurationMs: data.defaultDurationMs,
    plannedOwnerId: data.plannedOwnerId ? new Types.ObjectId(data.plannedOwnerId) : null,
    responsibleUserId: data.responsibleUserId ? new Types.ObjectId(data.responsibleUserId) : null,
    overrunPolicy: data.overrunPolicy,
    overrunReasonId: data.overrunReasonId ? new Types.ObjectId(data.overrunReasonId) : null,
    isActive: data.isActive ?? true,
    props: data.props,
    createdBy: new Types.ObjectId(userId),
  })
  emitPlannedStopTemplateCreated(doc._id.toString())
  return doc
}

export async function getById(id: string): Promise<IPlannedStopTemplate> {
  const doc = await PlannedStopTemplate.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IPlannedStopTemplate
}

export async function list(input: TemplateListInput): Promise<IPlannedStopTemplate[]> {
  const query: Record<string, unknown> = {}
  if (input.workCenterId) query.workCenterIds = new Types.ObjectId(input.workCenterId)
  if (input.reasonId) query.reasonId = new Types.ObjectId(input.reasonId)
  if (input.isActive !== undefined) query.isActive = input.isActive

  return PlannedStopTemplate.find(query)
    .sort({ name: 1 })
    .select('-__v')
    .lean<IPlannedStopTemplate[]>()
}

export async function update(
  id: string,
  data: UpdatePlannedStopTemplateInput,
  userId: string,
): Promise<IPlannedStopTemplate> {
  const existing = await PlannedStopTemplate.findById(id).select({ _id: 1 }).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')

  const $set: Record<string, unknown> = { updatedBy: new Types.ObjectId(userId) }

  if (data.workCenterIds !== undefined) {
    $set.workCenterIds = toObjectIds(data.workCenterIds)
  }
  if (data.reasonId !== undefined) {
    await assertReasonCompatible(new Types.ObjectId(data.reasonId), 'planned')
    $set.reasonId = new Types.ObjectId(data.reasonId)
  }
  if (data.overrunReasonId !== undefined) {
    if (data.overrunReasonId) {
      await assertReasonCompatible(new Types.ObjectId(data.overrunReasonId), 'unplanned')
      $set.overrunReasonId = new Types.ObjectId(data.overrunReasonId)
    } else {
      $set.overrunReasonId = null
    }
  }
  if (data.name !== undefined) $set.name = data.name
  if (data.description !== undefined) $set.description = data.description
  if (data.defaultDurationMs !== undefined) {
    if (data.defaultDurationMs < 1) {
      throw new CustomError(400, 'error.planned_stop_template_invalid_duration')
    }
    $set.defaultDurationMs = data.defaultDurationMs
  }
  if (data.plannedOwnerId !== undefined) {
    $set.plannedOwnerId = data.plannedOwnerId ? new Types.ObjectId(data.plannedOwnerId) : null
  }
  if (data.responsibleUserId !== undefined) {
    $set.responsibleUserId = data.responsibleUserId
      ? new Types.ObjectId(data.responsibleUserId)
      : null
  }
  if (data.overrunPolicy !== undefined) $set.overrunPolicy = data.overrunPolicy
  if (data.isActive !== undefined) $set.isActive = data.isActive
  if (data.props !== undefined) $set.props = data.props

  const doc = await PlannedStopTemplate.findOneAndUpdate(
    { _id: id },
    { $set },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitPlannedStopTemplateUpdated(doc._id.toString())
  return doc
}

export async function remove(id: string): Promise<IPlannedStopTemplate> {
  const doc = await PlannedStopTemplate.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitPlannedStopTemplateDeleted(doc._id.toString())
  return doc
}

async function assertReasonPlanned(reasonId: Types.ObjectId): Promise<void> {
  const reason = await Reason.findById(reasonId)
    .select({ canStartManually: 1, isActive: 1, usages: 1 })
    .lean()
  if (!reason) throw new CustomError(404, 'error.reason_not_found')
  if (!reason.isActive) throw new CustomError(400, 'error.reason_inactive')
  if (!reason.canStartManually) throw new CustomError(400, 'error.reason_canStartManually_denied')
  if (!reason.usages?.includes('planned_stop')) {
    throw new CustomError(400, 'error.reason_usage_mismatch')
  }
}

export async function startFromTemplate(
  templateId: string,
  data: StartFromTemplateInput,
  userId: string,
) {
  const template = await PlannedStopTemplate.findById(templateId).lean()
  if (!template) throw new CustomError(404, 'error.not_found')
  if (!template.isActive) throw new CustomError(400, 'error.planned_stop_template_inactive')

  const wcObjectId = new Types.ObjectId(data.workCenterId)
  if (template.workCenterIds.length > 0) {
    const allowed = template.workCenterIds.some(id => id.equals(wcObjectId))
    if (!allowed) {
      throw new CustomError(400, 'error.planned_stop_template_work_center_not_allowed')
    }
  }

  const actualStartAt = data.actualStartAt ?? new Date()
  const duration = data.plannedDurationMs ?? template.defaultDurationMs
  if (duration < 1) {
    throw new CustomError(400, 'error.planned_stop_template_invalid_duration')
  }
  const plannedEndAt = new Date(actualStartAt.getTime() + duration)

  await assertReasonPlanned(template.reasonId)

  const plannedOwner =
    template.plannedOwnerId ?? template.responsibleUserId ?? new Types.ObjectId(userId)

  // Atomic race-safe guard: create with status='active' first. The unique
  // partial index { workCenterId, status:'active' } serializes concurrent
  // template starts — only one activation wins. After the active planned
  // stop exists, closing the open unplanned stop is idempotent and safe
  // to retry; a crash between create and close leaves the unplanned open
  // briefly, which the next run-mode event or reconciler converges.
  const created = await (async () => {
    try {
      return await PlannedStop.create({
        workCenterId: wcObjectId,
        reasonId: template.reasonId,
        plannedOwnerId: plannedOwner,
        source: 'template',
        startMode: 'manual',
        status: 'active',
        plannedStartAt: actualStartAt,
        plannedEndAt,
        actualStartAt,
        operatorId: new Types.ObjectId(userId),
        templateId: template._id,
        description: data.description ?? template.description ?? null,
        createdBy: new Types.ObjectId(userId),
      })
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
        throw new CustomError(409, 'error.planned_stop_active_exists')
      }
      throw err
    }
  })()

  await closeOpenUnplanned(data.workCenterId, actualStartAt, { closedBy: userId })

  emitPlannedStopCreated(created._id.toString(), data.workCenterId)
  emitPlannedStopStarted(created._id.toString(), data.workCenterId)
  return created
}

export async function closeFromTemplate(
  plannedStopId: string,
  userId: string,
  options: { actualEndAt?: Date } = {},
) {
  const planned = await PlannedStop.findById(plannedStopId).lean()
  if (!planned) throw new CustomError(404, 'error.not_found')
  if (!planned.templateId) {
    throw new CustomError(400, 'error.planned_stop_not_from_template')
  }
  const template = await PlannedStopTemplate.findById(planned.templateId).lean()
  if (!template) throw new CustomError(404, 'error.planned_stop_template_not_found')

  const actualEndAt = options.actualEndAt ?? new Date()
  const plannedEndAt = planned.plannedEndAt

  if (template.overrunPolicy === 'extend_planned_until_close' && actualEndAt > plannedEndAt) {
    await PlannedStop.updateOne(
      { _id: planned._id, status: 'active' },
      { $set: { plannedEndAt: actualEndAt, updatedBy: new Types.ObjectId(userId) } },
    )
  }

  const closed = await closePlannedStop(plannedStopId, { actualEndAt }, userId)

  if (
    template.overrunPolicy === 'split_to_unplanned' &&
    actualEndAt > plannedEndAt &&
    template.overrunReasonId
  ) {
    await createManualUnplanned(
      {
        workCenterId: planned.workCenterId.toString(),
        startAt: plannedEndAt,
        endAt: actualEndAt,
        reasonId: template.overrunReasonId.toString(),
      },
      userId,
    )
  }

  return closed
}
