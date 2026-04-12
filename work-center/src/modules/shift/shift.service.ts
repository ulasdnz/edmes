import { Types } from 'mongoose'
import { CustomError } from '../../core/errors/index.js'
import { emitShiftCreated, emitShiftDeleted, emitShiftUpdated } from '../../jobs/events.js'
import { hasProductionShiftReferences } from '../../lib/internal-api.js'
import WorkCenter from '../work-center/work-center.model.js'
import { type IShift, Shift } from './shift.model.js'
import { onShiftCreated, onShiftDeleted, onShiftUpdated } from './shift.scheduler.js'
import { assertNoOverlap, type ShiftLike } from './shift.utils.js'
import type { CreateShiftInput, PatchShiftInput } from './shift.validators.js'

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

export async function listShifts(): Promise<IShift[]> {
  return Shift.find().sort({ name: 1 }).select('-__v').lean() as Promise<IShift[]>
}

export async function getShift(id: string): Promise<IShift> {
  const shift = (await Shift.findById(id).select('-__v').lean()) as IShift | null
  if (!shift) throw new CustomError(404, 'shift.not_found')
  return shift
}

export async function findShiftsByIds(ids: string[]): Promise<IShift[]> {
  if (ids.length === 0) return []
  return Shift.find({ _id: { $in: ids } })
    .select('-__v')
    .lean() as Promise<IShift[]>
}

export async function assertShiftsExist(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const count = await Shift.countDocuments({ _id: { $in: ids } })
  if (count !== new Set(ids.map(String)).size) {
    throw new CustomError(404, 'shift.not_found')
  }
}

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

  if (data.name !== undefined && data.name !== existing.name) {
    await assertUniqueName(data.name, id)
    existing.name = data.name
  }

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

async function assertReferencingAssignmentsRemainValid(
  shiftId: string,
  proposed: ShiftLike,
): Promise<void> {
  const workCenters = await WorkCenter.find({ shiftIds: shiftId }).select('_id shiftIds').lean()
  for (const wc of workCenters) {
    const set = await resolveAssignmentSet(wc.shiftIds ?? [], shiftId, proposed)
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

  const [wcRef, prodRef] = await Promise.all([
    WorkCenter.exists({ shiftIds: id }),
    hasProductionShiftReferences(id),
  ])

  if (wcRef || prodRef) {
    throw new CustomError(409, 'shift.in_use')
  }

  await Shift.deleteOne({ _id: id })
  onShiftDeleted(id)
  await emitShiftDeleted(id)
}

export { emitShiftCreated, emitShiftDeleted, emitShiftUpdated }
export { hasProductionShiftReferences }
