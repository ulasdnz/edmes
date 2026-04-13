import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasProductionShiftReferences } from '../../../lib/internal-api.js'
import { Calendar, DateException } from '../../schedule/schedule.model.js'
import WorkCenter from '../../work-center/work-center.model.js'
import { Shift } from '../shift.model.js'
import * as shiftService from '../shift.service.js'

const mockedHasProdRefs = vi.mocked(hasProductionShiftReferences)

vi.mock('../shift.scheduler.js', () => ({
  onShiftCreated: vi.fn(),
  onShiftUpdated: vi.fn(),
  onShiftDeleted: vi.fn(),
}))
vi.mock('../../../jobs/events.js', () => ({
  emitShiftCreated: vi.fn(),
  emitShiftUpdated: vi.fn(),
  emitShiftDeleted: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
}))
vi.mock('../../../lib/internal-api.js', () => ({
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
}))

const userId = new Types.ObjectId().toHexString()

describe('shift.service create/list/get', () => {
  beforeEach(async () => {
    await Shift.deleteMany({})
  })

  it('creates a shift', async () => {
    const shift = await shiftService.createShift(
      { name: 'Morning', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    expect(shift.name).toBe('Morning')
    expect(String(shift.createdBy)).toBe(userId)
  })

  it('rejects duplicate name case-insensitively', async () => {
    await shiftService.createShift(
      { name: 'Morning', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    await expect(
      shiftService.createShift(
        { name: 'MORNING', startHour: 6, startMinute: 0, endHour: 14, endMinute: 0 },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 409, message: 'shift.name_in_use' })
  })

  it('rejects when start == end', async () => {
    await expect(
      shiftService.createShift(
        { name: 'Bad', startHour: 8, startMinute: 0, endHour: 8, endMinute: 0 },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'shift.start_equals_end' })
  })

  it('allows overlapping shifts in the global catalog', async () => {
    await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    const b = await shiftService.createShift(
      { name: 'B', startHour: 10, startMinute: 0, endHour: 18, endMinute: 0 },
      userId,
    )
    expect(b.name).toBe('B')
  })

  it('lists shifts sorted by name', async () => {
    await shiftService.createShift(
      { name: 'Night', startHour: 22, startMinute: 0, endHour: 6, endMinute: 0 },
      userId,
    )
    await shiftService.createShift(
      { name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    const list = await shiftService.listShifts()
    expect(list.map(s => s.name)).toEqual(['Day', 'Night'])
  })

  it('getShift returns 404 for unknown id', async () => {
    const unknown = new Types.ObjectId().toHexString()
    await expect(shiftService.getShift(unknown)).rejects.toMatchObject({
      statusCode: 404,
      message: 'shift.not_found',
    })
  })
})

describe('shift.service update', () => {
  beforeEach(async () => {
    await Promise.all([
      Shift.deleteMany({}),
      WorkCenter.deleteMany({}),
      Calendar.deleteMany({}),
      DateException.deleteMany({}),
    ])
    mockedHasProdRefs.mockResolvedValue(false)
  })

  it('renames a shift', async () => {
    const s = await shiftService.createShift(
      { name: 'Morning', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    const out = await shiftService.updateShift(String(s._id), { name: 'Day' }, userId)
    expect(out.name).toBe('Day')
  })

  it('rejects rename collision', async () => {
    const a = await shiftService.createShift(
      { name: 'Morning', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    await shiftService.createShift(
      { name: 'Night', startHour: 22, startMinute: 0, endHour: 6, endMinute: 0 },
      userId,
    )
    await expect(
      shiftService.updateShift(String(a._id), { name: 'night' }, userId),
    ).rejects.toMatchObject({ statusCode: 409, message: 'shift.name_in_use' })
  })

  it('rejects time update that would make a referencing work-center assignment overlap', async () => {
    const a = await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
      userId,
    )
    const b = await shiftService.createShift(
      { name: 'B', startHour: 13, startMinute: 0, endHour: 18, endMinute: 0 },
      userId,
    )
    await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [a._id, b._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await expect(
      shiftService.updateShift(String(a._id), { endHour: 14 }, userId),
    ).rejects.toMatchObject({ statusCode: 400, message: 'shift.overlap_in_assignment' })
  })
})

describe('shift.service delete', () => {
  beforeEach(async () => {
    await Promise.all([
      Shift.deleteMany({}),
      WorkCenter.deleteMany({}),
      Calendar.deleteMany({}),
      DateException.deleteMany({}),
    ])
    mockedHasProdRefs.mockResolvedValue(false)
  })

  it('deletes an unreferenced shift', async () => {
    const s = await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    await shiftService.deleteShift(String(s._id))
    expect(await Shift.findById(s._id)).toBeNull()
  })

  it('blocks delete when referenced by WorkCenter.shiftIds', async () => {
    const s = await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      shiftIds: [s._id],
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await expect(shiftService.deleteShift(String(s._id))).rejects.toMatchObject({
      statusCode: 409,
      message: 'shift.in_use',
    })
  })

  it('blocks delete when referenced by production (internal API)', async () => {
    const s = await shiftService.createShift(
      { name: 'A', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    mockedHasProdRefs.mockResolvedValue(true)
    await expect(shiftService.deleteShift(String(s._id))).rejects.toMatchObject({
      statusCode: 409,
      message: 'shift.in_use',
    })
  })
})

describe('shift.service active-shift update rules', () => {
  beforeEach(async () => {
    await Shift.deleteMany({})
  })

  it('rejects end-time update moving end before now on the currently running occurrence (409)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T07:00:00.000Z'))
    const s = await shiftService.createShift(
      { name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    // Try to move end to 09:00 → in the past → reject
    await expect(
      shiftService.updateShift(String(s._id), { endHour: 9 }, userId),
    ).rejects.toMatchObject({ statusCode: 409, message: 'shift.end_before_now' })
    vi.useRealTimers()
  })

  it('accepts end-time update moving end further into the future', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T07:00:00.000Z'))
    const s = await shiftService.createShift(
      { name: 'Day', startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      userId,
    )
    const updated = await shiftService.updateShift(String(s._id), { endHour: 18 }, userId)
    expect(updated.endHour).toBe(18)
    vi.useRealTimers()
  })
})
