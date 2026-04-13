import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitOperatorCheckedOut } from '../../../jobs/events.js'
import { OperatorCheckIn } from '../../operators/operators.model.js'
import { DateException } from '../../schedule/schedule.model.js'
import WorkCenter from '../../work-center/work-center.model.js'
import { Shift } from '../shift.model.js'
import { reconcileOpenCheckInsAtStartup } from '../shift.reconciliation.js'

vi.mock('../../../jobs/events.js', () => ({
  emitOperatorCheckedOut: vi.fn(),
  emitOperatorCheckedIn: vi.fn(),
}))

const mockedEmit = vi.mocked(emitOperatorCheckedOut)
const userId = new Types.ObjectId().toHexString()

describe('reconcileOpenCheckInsAtStartup', () => {
  beforeEach(async () => {
    await Promise.all([
      WorkCenter.deleteMany({}),
      Shift.deleteMany({}),
      OperatorCheckIn.deleteMany({}),
      DateException.deleteMany({}),
    ])
    mockedEmit.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes a stale check-in at the missed shift-end boundary (single day shift)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T17:00:00.000Z'))
    const s = await Shift.create({
      name: 'Day',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [s._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-10T06:00:00.000Z'),
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt?.toISOString()).toBe('2026-04-10T13:00:00.000Z')
    expect(after?.checkoutSource).toBe('shift_boundary')
    expect(mockedEmit).toHaveBeenCalledWith(
      String(wc._id),
      expect.any(String),
      String(ci._id),
      'shift_boundary',
    )
  })

  it('closes a stale check-in at the missed night→day rollover boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T05:10:00.000Z'))
    const night = await Shift.create({
      name: 'Night',
      startHour: 22,
      startMinute: 0,
      endHour: 6,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const day = await Shift.create({
      name: 'Day',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [night._id, day._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-09T20:00:00.000Z'),
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt?.toISOString()).toBe('2026-04-10T03:00:00.000Z')
    expect(after?.checkoutSource).toBe('shift_boundary')
  })

  it('leaves a check-in alone when the SAME occurrence is still running', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T08:00:00.000Z'))
    const s = await Shift.create({
      name: 'Day',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [s._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-10T05:30:00.000Z'),
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt).toBeNull()
  })

  it('closes check-ins on work centers with no effective schedule (source=none)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T10:00:00.000Z'))
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-09T10:00:00.000Z'),
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt?.toISOString()).toBe('2026-04-10T10:00:00.000Z')
  })

  it('caps the lookback for very old check-ins (safety limit)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T17:00:00.000Z'))
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-03-11T10:00:00.000Z'),
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
  })

  it('does not fan a shift across days where it is not scheduled (phantom-shift)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T11:00:00.000Z'))
    const day = await Shift.create({
      name: 'Day',
      startHour: 8,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [day._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await DateException.create({
      workCenterId: wc._id,
      localDate: '2026-04-08',
      shiftIds: [],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await DateException.create({
      workCenterId: wc._id,
      localDate: '2026-04-09',
      shiftIds: [],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-08T07:00:00.000Z'),
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([String(ci._id)])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt?.toISOString()).toBe('2026-04-10T11:00:00.000Z')
    expect(after?.checkoutSource).toBe('shift_boundary')
  })

  it('leaves an overnight occurrence alone when it is still running', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T23:00:00.000Z'))
    const night = await Shift.create({
      name: 'Night',
      startHour: 22,
      startMinute: 0,
      endHour: 6,
      endMinute: 0,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [night._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await DateException.create({
      workCenterId: wc._id,
      localDate: '2026-04-10',
      shiftIds: [],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const ci = await OperatorCheckIn.create({
      workCenterId: wc._id,
      operatorId: new Types.ObjectId(),
      checkedInAt: new Date('2026-04-09T20:00:00.000Z'),
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const closed = await reconcileOpenCheckInsAtStartup()
    expect(closed).toEqual([])
    const after = await OperatorCheckIn.findById(ci._id)
    expect(after?.checkedOutAt).toBeNull()
    expect(mockedEmit).not.toHaveBeenCalled()
  })
})
