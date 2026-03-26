import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { JobOrder } from '../job-order/job-order.model.js'
import { ProductStandard } from '../product-standard/product-standard.model.js'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'

vi.mock('../../jobs/events.js', () => ({
  emitQuantityAdjustmentCreated: vi.fn(),
  emitQuantityAdjustmentUpdated: vi.fn(),
  emitQuantityAdjustmentDeleted: vi.fn(),
  emitScrapEntryCreated: vi.fn(),
  emitScrapEntryUpdated: vi.fn(),
  emitScrapEntryDeleted: vi.fn(),
}))

const wcId = new Types.ObjectId()
const otherWcId = new Types.ObjectId()
const productId = new Types.ObjectId()
const userId = new Types.ObjectId()

describe('WorkCenterReferences (logic)', () => {
  async function getReferences(workCenterId: string) {
    const [totalRefs, startedJOs] = await Promise.all([
      Promise.all([
        ProductStandard.countDocuments({ workCenterId }),
        JobOrder.countDocuments({ workCenterId }),
        QuantityAdjustment.countDocuments({ workCenterId }),
        ScrapEntry.countDocuments({ workCenterId }),
      ]).then(counts => counts.reduce((a, b) => a + b, 0)),
      JobOrder.countDocuments({ workCenterId, startTime: { $ne: null } }),
    ])

    return {
      inUse: totalRefs > 0,
      hasStartedJobOrders: startedJOs > 0,
    }
  }

  it('returns inUse=false when no records reference the work center', async () => {
    const result = await getReferences(wcId.toString())

    expect(result.inUse).toBe(false)
    expect(result.hasStartedJobOrders).toBe(false)
  })

  it('returns inUse=true when a product standard references the work center', async () => {
    await ProductStandard.create({
      productId,
      workCenterId: wcId,
      validFrom: new Date('2026-01-01'),
      idealOutputPerMinute: 10,
      createdBy: userId,
    })

    const result = await getReferences(wcId.toString())

    expect(result.inUse).toBe(true)
    expect(result.hasStartedJobOrders).toBe(false)
  })

  it('returns inUse=true when a job order references the work center', async () => {
    await JobOrder.create({
      code: `JO-REF-${Date.now()}`,
      productId,
      workCenterId: wcId,
      targetQuantity: 100,
      plannedStartAt: new Date('2026-03-01'),
      dueAt: new Date('2026-04-01'),
      createdBy: userId,
    })

    const result = await getReferences(wcId.toString())

    expect(result.inUse).toBe(true)
    expect(result.hasStartedJobOrders).toBe(false)
  })

  it('returns hasStartedJobOrders=true when a started job order exists', async () => {
    await JobOrder.create({
      code: `JO-START-${Date.now()}`,
      productId,
      workCenterId: wcId,
      targetQuantity: 100,
      plannedStartAt: new Date('2026-03-01'),
      dueAt: new Date('2026-04-01'),
      startTime: new Date('2026-03-01T08:00:00Z'),
      startedBy: userId,
      createdBy: userId,
    })

    const result = await getReferences(wcId.toString())

    expect(result.inUse).toBe(true)
    expect(result.hasStartedJobOrders).toBe(true)
  })

  it('does not count records from other work centers', async () => {
    await JobOrder.create({
      code: `JO-OTHER-${Date.now()}`,
      productId,
      workCenterId: otherWcId,
      targetQuantity: 50,
      plannedStartAt: new Date('2026-03-01'),
      dueAt: new Date('2026-04-01'),
      startTime: new Date('2026-03-01T08:00:00Z'),
      startedBy: userId,
      createdBy: userId,
    })

    const result = await getReferences(wcId.toString())

    expect(result.inUse).toBe(false)
    expect(result.hasStartedJobOrders).toBe(false)
  })
})
