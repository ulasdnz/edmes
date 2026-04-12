import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitOperatorCheckedOut } from '../../../jobs/events.js'
import { Shift } from '../../shift/shift.model.js'
import WorkCenter from '../../work-center/work-center.model.js'
import { OperatorCheckIn } from '../operators.model.js'
import * as operatorService from '../operators.service.js'

vi.mock('../../../jobs/events.js', () => ({
  emitOperatorCheckedIn: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
  emitScheduleChanged: vi.fn(),
}))
vi.mock('../../../lib/internal-api.js', () => ({
  validateOperatorExists: vi.fn().mockResolvedValue(true),
  addWorkCenterToUser: vi.fn(),
  isWorkCenterReferencedByUsers: vi.fn().mockResolvedValue(false),
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
}))

const mockedEmit = vi.mocked(emitOperatorCheckedOut)
const userId = new Types.ObjectId().toHexString()

async function mkShift(name: string, sh: number, eh: number) {
  return Shift.create({
    name,
    startHour: sh,
    startMinute: 0,
    endHour: eh,
    endMinute: 0,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

async function mkWc(name: string, shiftIds: Types.ObjectId[] = []) {
  return WorkCenter.create({
    code: name,
    name,
    type: 'physical',
    shiftIds,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

describe('autoCheckOutByShiftEnd', () => {
  beforeEach(async () => {
    await Promise.all([
      WorkCenter.deleteMany({}),
      Shift.deleteMany({}),
      OperatorCheckIn.deleteMany({}),
    ])
    mockedEmit.mockClear()
  })

  it('closes open check-ins only on work centers whose effective schedule contains the shift', async () => {
    const shift = await mkShift('Day', 8, 16)
    const other = await mkShift('Other', 18, 22)
    const wcAffected = await mkWc('WC_A', [shift._id])
    const wcUntouched = await mkWc('WC_B', [other._id])

    const ciA = await operatorService.checkIn(
      String(wcAffected._id),
      { operatorId: new Types.ObjectId().toHexString() },
      userId,
    )
    const ciB = await operatorService.checkIn(
      String(wcUntouched._id),
      { operatorId: new Types.ObjectId().toHexString() },
      userId,
    )

    const result = await operatorService.autoCheckOutByShiftEnd(String(shift._id), '2026-04-10')
    expect(result).toEqual({
      affectedWorkCenterIds: [String(wcAffected._id)],
      closedCheckInIds: [String(ciA._id)],
    })

    const a = await OperatorCheckIn.findById(ciA._id)
    const b = await OperatorCheckIn.findById(ciB._id)
    expect(a?.checkedOutAt).toBeTruthy()
    expect(a?.checkoutSource).toBe('shift_boundary')
    expect(b?.checkedOutAt).toBeNull()

    expect(mockedEmit).toHaveBeenCalledWith(
      String(wcAffected._id),
      expect.any(String),
      String(ciA._id),
      'shift_boundary',
    )
  })

  it('is idempotent — repeated call does not re-close or re-emit', async () => {
    const shift = await mkShift('Day', 8, 16)
    const wc = await mkWc('WC_A', [shift._id])
    await operatorService.checkIn(
      String(wc._id),
      { operatorId: new Types.ObjectId().toHexString() },
      userId,
    )
    await operatorService.autoCheckOutByShiftEnd(String(shift._id), '2026-04-10')
    mockedEmit.mockClear()
    const second = await operatorService.autoCheckOutByShiftEnd(String(shift._id), '2026-04-10')
    expect(second.closedCheckInIds).toEqual([])
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('closes check-in records with shiftId: null on an affected work center', async () => {
    const shift = await mkShift('Day', 8, 16)
    const wc = await mkWc('WC_A', [shift._id])
    const ci = await operatorService.checkIn(
      String(wc._id),
      { operatorId: new Types.ObjectId().toHexString() }, // no shiftId
      userId,
    )
    await operatorService.autoCheckOutByShiftEnd(String(shift._id), '2026-04-10')
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt).toBeTruthy()
  })

  it('respects closed-day exception (source=exception, shiftIds=[])', async () => {
    const shift = await mkShift('Day', 8, 16)
    const wc = await mkWc('WC_A', [shift._id])
    const { upsertException } = await import('../../schedule/schedule.service.js')
    await upsertException(String(wc._id), '2026-04-10', { shiftIds: [] }, userId)

    const ci = await operatorService.checkIn(
      String(wc._id),
      { operatorId: new Types.ObjectId().toHexString() },
      userId,
    )
    const result = await operatorService.autoCheckOutByShiftEnd(String(shift._id), '2026-04-10')
    // The exception on that day removed the shift → WC is NOT affected → no close.
    expect(result.affectedWorkCenterIds).toEqual([])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt).toBeNull()
  })
})
