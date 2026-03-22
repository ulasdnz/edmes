import { CustomError } from '../../core/errors/index.js'
import { emitOperatorCheckedIn, emitOperatorCheckedOut } from '../../jobs/events.js'
import { validateOperatorExists } from '../../lib/internal-api.js'
import WorkCenter from '../work-center/work-center.model.js'
import { type IOperatorCheckIn, OperatorCheckIn } from './operators.model.js'
import type { CheckInInput } from './operators.validators.js'

// ── Check-in ────────────────────────────────────────────────────────────────

export async function checkIn(
  workCenterId: string,
  data: CheckInInput,
  userId: string,
): Promise<IOperatorCheckIn> {
  const wc = await WorkCenter.findById(workCenterId).select('type status').lean()
  if (!wc) throw new CustomError(404, 'work_center.not_found')
  if (wc.type !== 'physical') throw new CustomError(400, 'work_center.must_be_physical')
  if (wc.status !== 'active') throw new CustomError(400, 'work_center.must_be_active')

  // Duplicate active check-in prevention (same WC + operator)
  const existing = await OperatorCheckIn.findOne({
    workCenterId,
    operatorId: data.operatorId,
    checkedOutAt: null,
  }).lean()
  if (existing) throw new CustomError(409, 'operators.duplicate_active_checkin')

  // Validate operator exists in user-service
  if (!(await validateOperatorExists(data.operatorId))) {
    throw new CustomError(404, 'operators.operator_not_found')
  }

  const doc = new OperatorCheckIn({
    workCenterId,
    operatorId: data.operatorId,
    shiftId: data.shiftId ?? null,
    checkedInAt: new Date(),
    createdBy: userId,
    updatedBy: userId,
  })

  const saved = await doc.save()
  await emitOperatorCheckedIn(workCenterId, data.operatorId, String(saved._id))
  return saved
}

// ── Check-out ───────────────────────────────────────────────────────────────

export async function checkOut(
  workCenterId: string,
  checkInId: string,
  userId: string,
): Promise<IOperatorCheckIn> {
  const record = await OperatorCheckIn.findOne({ _id: checkInId, workCenterId })
  if (!record) throw new CustomError(404, 'operators.checkin_not_found')
  if (record.checkedOutAt) throw new CustomError(400, 'operators.already_checked_out')

  record.checkedOutAt = new Date()
  record.updatedBy = userId

  const saved = await record.save()
  await emitOperatorCheckedOut(workCenterId, String(record.operatorId), String(saved._id))
  return saved
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getActiveCheckIns(workCenterId: string): Promise<IOperatorCheckIn[]> {
  return OperatorCheckIn.find({ workCenterId, checkedOutAt: null })
    .sort({ checkedInAt: -1 })
    .lean() as Promise<IOperatorCheckIn[]>
}

// ── Lifecycle guards (used by work-center service) ──────────────────────────

export async function hasOpenCheckIns(workCenterId: string): Promise<boolean> {
  const count = await OperatorCheckIn.countDocuments({ workCenterId, checkedOutAt: null })
  return count > 0
}

export async function hasAnyCheckInRecords(workCenterId: string): Promise<boolean> {
  const count = await OperatorCheckIn.countDocuments({ workCenterId })
  return count > 0
}

// ── Auto check-out (shift-ended event) ──────────────────────────────────────

export async function autoCheckOutByShift(workCenterId: string): Promise<string[]> {
  const openCheckIns = await OperatorCheckIn.find({ workCenterId, checkedOutAt: null })
  const checkedOutIds: string[] = []
  const now = new Date()

  for (const ci of openCheckIns) {
    ci.checkedOutAt = now
    ci.updatedBy = 'system'
    await ci.save()
    await emitOperatorCheckedOut(workCenterId, String(ci.operatorId), String(ci._id))
    checkedOutIds.push(String(ci._id))
  }

  return checkedOutIds
}
