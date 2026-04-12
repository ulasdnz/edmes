import { Types } from 'mongoose'
import { CustomError } from '../../core/errors/index.js'
import { emitShiftCreated, emitShiftDeleted, emitShiftUpdated } from '../../jobs/events.js'
import { hasProductionShiftReferences } from '../../lib/internal-api.js'
import { type IShift, Shift } from './shift.model.js'
import { onShiftCreated, onShiftDeleted, onShiftUpdated } from './shift.scheduler.js'
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

// updateShift / deleteShift are added in Task 5.

export { emitShiftCreated, emitShiftDeleted, emitShiftUpdated }
export { hasProductionShiftReferences }
