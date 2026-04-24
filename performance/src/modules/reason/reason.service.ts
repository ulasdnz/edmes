import { CustomError } from '@mes/core'
import mongoose, { Types } from 'mongoose'
import { emitReasonCreated, emitReasonDeleted, emitReasonUpdated } from '../../jobs/events.js'
import { type IReason, Reason } from './reason.model.js'
import type { CreateReasonInput, PatchReasonInput, ReasonListInput } from './reason.validators.js'

const REFERENCING_COLLECTIONS: Array<{ model: string; field: string }> = [
  { model: 'PlannedStop', field: 'reasonId' },
  { model: 'UnplannedStop', field: 'reasonId' },
  { model: 'PlannedStopSchedule', field: 'reasonId' },
  { model: 'PlannedStopTemplate', field: 'reasonId' },
  { model: 'PlannedStopTemplate', field: 'overrunReasonId' },
]

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
}

export async function create(data: CreateReasonInput, userId: string): Promise<IReason> {
  try {
    const doc = await Reason.create({
      ...data,
      createdBy: new Types.ObjectId(userId),
    })
    emitReasonCreated(doc._id.toString())
    return doc
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new CustomError(409, 'error.duplicate')
    }
    throw err
  }
}

export async function getById(id: string): Promise<IReason> {
  const doc = await Reason.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IReason
}

export async function getByCode(code: string): Promise<IReason | null> {
  const doc = await Reason.findOne({ code }).lean().select('-__v')
  return (doc as IReason) ?? null
}

export async function getSystemReasonIdByCode(code: string): Promise<Types.ObjectId> {
  const doc = await Reason.findOne({ code, isSystemDefault: true })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>()
  if (!doc) throw new CustomError(500, 'error.micro_stop_missing')
  return doc._id
}

type ReasonIdProjection = { _id: Types.ObjectId }

export async function list(input: ReasonListInput): Promise<IReason[] | ReasonIdProjection[]> {
  const { fields, usage, workCenterId, ...rest } = input

  const query: Record<string, unknown> = {}
  if (rest.code !== undefined) query.code = rest.code
  if (rest.name !== undefined) query.name = rest.name
  if (rest.affectsOee !== undefined) query.affectsOee = rest.affectsOee
  if (rest.isActive !== undefined) query.isActive = rest.isActive
  if (rest.isSystemDefault !== undefined) query.isSystemDefault = rest.isSystemDefault
  if (usage && usage.length > 0) query.usages = { $in: usage }
  if (workCenterId !== undefined) query.workCenterIds = new Types.ObjectId(workCenterId)

  if (fields?.includes('_id')) {
    return Reason.find(query)
      .sort({ createdAt: -1 })
      .select({ _id: 1 })
      .lean<ReasonIdProjection[]>()
  }

  return Reason.find(query).sort({ createdAt: -1 }).select('-__v').lean<IReason[]>()
}

export async function update(id: string, data: PatchReasonInput, userId: string): Promise<IReason> {
  const existing = await Reason.findById(id).select({ isSystemDefault: 1 }).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')
  if (existing.isSystemDefault) {
    throw new CustomError(409, 'error.reason_system_default_immutable')
  }

  const $set: Record<string, unknown> = {
    ...data,
    updatedBy: new Types.ObjectId(userId),
  }
  if (data.workCenterIds) {
    $set.workCenterIds = data.workCenterIds.map(wc => new Types.ObjectId(wc))
  }

  try {
    const doc = await Reason.findOneAndUpdate(
      { _id: id },
      { $set },
      { returnDocument: 'after', runValidators: true },
    )
    if (!doc) throw new CustomError(404, 'error.not_found')
    emitReasonUpdated(id)
    return doc
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new CustomError(409, 'error.duplicate')
    }
    throw err
  }
}

async function isReferenced(reasonId: string): Promise<boolean> {
  const registered = new Set(mongoose.modelNames())
  const checks = REFERENCING_COLLECTIONS.filter(r => registered.has(r.model)).map(async r => {
    const Model = mongoose.model(r.model)
    const hit = await Model.exists({ [r.field]: reasonId })
    return hit !== null
  })
  const results = await Promise.all(checks)
  return results.some(Boolean)
}

export async function findIds({
  affectsOee,
  usages,
}: {
  affectsOee: boolean
  usages: string[]
}): Promise<Set<string>> {
  // $in matches reasons whose usages array contains AT LEAST ONE of the provided values (OR semantics).
  const docs = await Reason.find({ affectsOee, usages: { $in: usages } })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>()
  return new Set(docs.map(d => d._id.toString()))
}

export async function remove(id: string, userId: string): Promise<IReason> {
  const existing = await Reason.findById(id).select({ isSystemDefault: 1 }).lean()
  if (!existing) throw new CustomError(404, 'error.not_found')
  if (existing.isSystemDefault) {
    throw new CustomError(409, 'error.reason_system_default_immutable')
  }

  if (await isReferenced(id)) {
    const soft = await Reason.findOneAndUpdate(
      { _id: id },
      { $set: { isActive: false, updatedBy: new Types.ObjectId(userId) } },
      { returnDocument: 'after', runValidators: true },
    )
    if (!soft) throw new CustomError(404, 'error.not_found')
    emitReasonUpdated(id)
    return soft
  }

  const doc = await Reason.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitReasonDeleted(id)
  return doc
}
