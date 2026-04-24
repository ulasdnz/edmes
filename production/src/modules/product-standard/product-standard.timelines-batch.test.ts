import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { ProductStandard } from './product-standard.model.js'
import { findTimelinesBatch } from './product-standard.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitProductStandardCreated: vi.fn(),
  emitProductStandardUpdated: vi.fn(),
  emitProductStandardDeleted: vi.fn(),
}))

vi.mock('../../lib/internal-api.js', () => ({
  getWorkCenterInfo: vi.fn(),
  getUserWorkCenterIds: vi.fn(),
}))

const createdBy = new Types.ObjectId()

async function seedStandard(
  productId: Types.ObjectId,
  workCenterId: Types.ObjectId,
  validFrom: Date,
  idealOutputPerMinute = 10,
) {
  return ProductStandard.create({
    productId,
    workCenterId,
    validFrom,
    idealOutputPerMinute,
    counterMultiplier: 1,
    createdBy,
  })
}

describe('findTimelinesBatch', () => {
  it('returns baseline + revisions per item', async () => {
    const productId = new Types.ObjectId()
    const workCenterId = new Types.ObjectId()

    const baseline = await seedStandard(
      productId,
      workCenterId,
      new Date('2026-03-01T00:00:00Z'),
      10,
    )
    const revision1 = await seedStandard(
      productId,
      workCenterId,
      new Date('2026-03-10T00:00:00Z'),
      20,
    )
    const revision2 = await seedStandard(
      productId,
      workCenterId,
      new Date('2026-03-15T00:00:00Z'),
      30,
    )
    // Out-of-range revision — should not appear
    await seedStandard(productId, workCenterId, new Date('2026-03-25T00:00:00Z'), 40)

    const jobOrderId = new Types.ObjectId().toString()
    const result = await findTimelinesBatch({
      items: [
        {
          jobOrderId,
          workCenterId: workCenterId.toString(),
          productId: productId.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-20T00:00:00Z'),
        },
      ],
    })

    expect(result.items).toHaveLength(1)
    const item = result.items[0]
    expect(item.jobOrderId).toBe(jobOrderId)
    expect(item.qualityFlags).toEqual([])
    expect(item.standards.map(s => s._id)).toEqual([
      baseline._id.toString(),
      revision1._id.toString(),
      revision2._id.toString(),
    ])
    expect(item.standards[0].idealOutputPerMinute).toBe(10)
    expect(item.standards[2].idealOutputPerMinute).toBe(30)
  })

  it('deduplicates DB reads for items sharing (workCenterId, productId)', async () => {
    const productId = new Types.ObjectId()
    const workCenterId = new Types.ObjectId()

    await seedStandard(productId, workCenterId, new Date('2026-03-01T00:00:00Z'), 10)

    const findSpy = vi.spyOn(ProductStandard, 'find')
    const findOneSpy = vi.spyOn(ProductStandard, 'findOne')

    await findTimelinesBatch({
      items: [
        {
          jobOrderId: new Types.ObjectId().toString(),
          workCenterId: workCenterId.toString(),
          productId: productId.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-10T00:00:00Z'),
        },
        {
          jobOrderId: new Types.ObjectId().toString(),
          workCenterId: workCenterId.toString(),
          productId: productId.toString(),
          from: new Date('2026-03-11T00:00:00Z'),
          to: new Date('2026-03-15T00:00:00Z'),
        },
        {
          jobOrderId: new Types.ObjectId().toString(),
          workCenterId: workCenterId.toString(),
          productId: productId.toString(),
          from: new Date('2026-03-16T00:00:00Z'),
          to: new Date('2026-03-20T00:00:00Z'),
        },
      ],
    })

    // Per group: one findOne for the baseline + one find for in-range revisions.
    expect(findOneSpy).toHaveBeenCalledTimes(1)
    expect(findSpy).toHaveBeenCalledTimes(1)
    findSpy.mockRestore()
    findOneSpy.mockRestore()
  })

  it('returns no_standard_for_interval when no baseline exists', async () => {
    const productId = new Types.ObjectId()
    const workCenterId = new Types.ObjectId()

    // revision after the window start but none before → no baseline
    await seedStandard(productId, workCenterId, new Date('2026-03-20T00:00:00Z'), 10)

    const result = await findTimelinesBatch({
      items: [
        {
          jobOrderId: new Types.ObjectId().toString(),
          workCenterId: workCenterId.toString(),
          productId: productId.toString(),
          from: new Date('2026-03-01T00:00:00Z'),
          to: new Date('2026-03-10T00:00:00Z'),
        },
      ],
    })

    expect(result.items[0].qualityFlags).toEqual(['no_standard_for_interval'])
    expect(result.items[0].standards).toEqual([])
  })

  it('independently resolves different (productId, workCenterId) groups', async () => {
    const productA = new Types.ObjectId()
    const productB = new Types.ObjectId()
    const workCenter = new Types.ObjectId()

    await seedStandard(productA, workCenter, new Date('2026-03-01T00:00:00Z'), 5)
    await seedStandard(productB, workCenter, new Date('2026-03-01T00:00:00Z'), 50)

    const result = await findTimelinesBatch({
      items: [
        {
          jobOrderId: 'jo-a',
          workCenterId: workCenter.toString(),
          productId: productA.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-10T00:00:00Z'),
        },
        {
          jobOrderId: 'jo-b',
          workCenterId: workCenter.toString(),
          productId: productB.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-10T00:00:00Z'),
        },
      ].map(i => ({ ...i, jobOrderId: new Types.ObjectId().toString() })),
    })

    expect(result.items).toHaveLength(2)
    expect(result.items[0].standards[0].idealOutputPerMinute).toBe(5)
    expect(result.items[1].standards[0].idealOutputPerMinute).toBe(50)
  })
})
