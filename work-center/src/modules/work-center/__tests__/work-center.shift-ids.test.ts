import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Shift } from '../../shift/shift.model.js'
import WorkCenter from '../work-center.model.js'
import * as workCenterService from '../work-center.service.js'

vi.mock('../../../jobs/events.js', () => ({
  emitWorkCenterCreated: vi.fn(),
  emitWorkCenterUpdated: vi.fn(),
  emitWorkCenterArchived: vi.fn(),
  emitWorkCenterReactivated: vi.fn(),
  emitWorkCenterDeleted: vi.fn(),
  emitHierarchyChanged: vi.fn(),
  emitMetricCompositionChanged: vi.fn(),
  emitScheduleChanged: vi.fn(),
  emitOperatorCheckedIn: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
}))
vi.mock('../../../lib/internal-api.js', () => ({
  addWorkCenterToUser: vi.fn(),
  isWorkCenterReferencedByUsers: vi.fn().mockResolvedValue(false),
  validateOperatorExists: vi.fn().mockResolvedValue(true),
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
}))

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

describe('workCenter.shiftIds update', () => {
  beforeEach(async () => {
    await Promise.all([WorkCenter.deleteMany({}), Shift.deleteMany({})])
  })

  it('accepts non-overlapping set', async () => {
    const a = await mkShift('A', 8, 16)
    const b = await mkShift('B', 16, 0) // 16:00 - 00:00, adjacent not overlapping
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const updated = await workCenterService.updateWorkCenter(
      String(wc._id),
      { shiftIds: [String(a._id), String(b._id)] },
      userId,
    )
    expect(updated.shiftIds.map(String)).toEqual([String(a._id), String(b._id)])
  })

  it('rejects overlapping set', async () => {
    const a = await mkShift('A', 8, 16)
    const b = await mkShift('B', 10, 18)
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    await expect(
      workCenterService.updateWorkCenter(
        String(wc._id),
        { shiftIds: [String(a._id), String(b._id)] },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'shift.overlap_in_assignment' })
  })

  it('rejects non-existent shift id', async () => {
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const bogus = new Types.ObjectId().toHexString()
    await expect(
      workCenterService.updateWorkCenter(String(wc._id), { shiftIds: [bogus] }, userId),
    ).rejects.toMatchObject({ statusCode: 404, message: 'shift.not_found' })
  })
})
