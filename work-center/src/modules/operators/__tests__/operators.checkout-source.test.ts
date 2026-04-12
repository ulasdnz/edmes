import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkCenter from '../../work-center/work-center.model.js'
import { OperatorCheckIn } from '../operators.model.js'
import * as operatorService from '../operators.service.js'

vi.mock('../../../jobs/events.js', () => ({
  emitOperatorCheckedIn: vi.fn(),
  emitOperatorCheckedOut: vi.fn(),
}))
vi.mock('../../../lib/internal-api.js', () => ({
  validateOperatorExists: vi.fn().mockResolvedValue(true),
  addWorkCenterToUser: vi.fn(),
  isWorkCenterReferencedByUsers: vi.fn().mockResolvedValue(false),
  hasProductionShiftReferences: vi.fn().mockResolvedValue(false),
}))

const userId = new Types.ObjectId().toHexString()

describe('operators checkoutSource', () => {
  beforeEach(async () => {
    await Promise.all([WorkCenter.deleteMany({}), OperatorCheckIn.deleteMany({})])
  })

  it('writes manual on user-triggered check-out', async () => {
    const wc = await WorkCenter.create({
      code: 'WC1',
      name: 'WC1',
      type: 'physical',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    })
    const opId = new Types.ObjectId().toHexString()
    const ci = await operatorService.checkIn(String(wc._id), { operatorId: opId }, userId)
    const out = await operatorService.checkOut(String(wc._id), String(ci._id), userId)
    expect(out.checkoutSource).toBe('manual')
  })
})
