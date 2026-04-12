import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Shift } from '../shift.model.js'
import * as shiftService from '../shift.service.js'

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
