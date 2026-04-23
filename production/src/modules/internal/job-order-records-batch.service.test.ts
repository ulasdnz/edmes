import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'
import { findJobOrderRecordsBatch } from './job-order-records-batch.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitQuantityAdjustmentCreated: vi.fn(),
  emitQuantityAdjustmentUpdated: vi.fn(),
  emitQuantityAdjustmentDeleted: vi.fn(),
  emitScrapEntryCreated: vi.fn(),
  emitScrapEntryUpdated: vi.fn(),
  emitScrapEntryDeleted: vi.fn(),
}))

const wcId = new Types.ObjectId()
const productId = new Types.ObjectId()
const shiftId = new Types.ObjectId()
const actor = new Types.ObjectId()

async function seedQa(jobOrderId: Types.ObjectId, time: Date, amount = 5) {
  return QuantityAdjustment.create({
    jobOrderId,
    workCenterId: wcId,
    productId,
    shiftId,
    amount,
    time,
    reason: 'manual_count',
    createdBy: actor,
  })
}

async function seedScrap(jobOrderId: Types.ObjectId, startTime: Date, endTime: Date, amount = 2) {
  return ScrapEntry.create({
    jobOrderId,
    workCenterId: wcId,
    productId,
    shiftId,
    amount,
    startTime,
    endTime,
    reasonId: new Types.ObjectId(),
    createdBy: actor,
  })
}

describe('findJobOrderRecordsBatch', () => {
  it('returns quantity adjustments grouped by jobOrderId', async () => {
    const joA = new Types.ObjectId()
    const joB = new Types.ObjectId()

    await seedQa(joA, new Date('2026-03-05T01:00:00Z'), 3)
    await seedQa(joA, new Date('2026-03-05T02:00:00Z'), 4)
    await seedQa(joB, new Date('2026-03-05T03:00:00Z'), 7)
    // Outside range — excluded
    await seedQa(joA, new Date('2026-03-01T00:00:00Z'), 99)

    const result = await findJobOrderRecordsBatch({
      include: ['quantity_adjustments'],
      items: [
        {
          jobOrderId: joA.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-05T12:00:00Z'),
        },
        {
          jobOrderId: joB.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-05T12:00:00Z'),
        },
      ],
    })

    expect(result.quantityAdjustmentsByJobOrderId).toBeDefined()
    expect(result.scrapEntriesByJobOrderId).toBeUndefined()
    const qas = result.quantityAdjustmentsByJobOrderId!
    expect(qas[joA.toString()].map(q => q.amount).sort()).toEqual([3, 4])
    expect(qas[joB.toString()].map(q => q.amount)).toEqual([7])
  })

  it('returns scrap entries overlapping the window (partial overlaps included)', async () => {
    const jo = new Types.ObjectId()

    // Fully inside — included
    await seedScrap(jo, new Date('2026-03-05T02:00:00Z'), new Date('2026-03-05T03:00:00Z'), 1)
    // Partial overlap at start — included
    await seedScrap(jo, new Date('2026-03-04T22:00:00Z'), new Date('2026-03-05T01:00:00Z'), 2)
    // Partial overlap at end — included
    await seedScrap(jo, new Date('2026-03-05T11:00:00Z'), new Date('2026-03-05T13:00:00Z'), 3)
    // Fully outside (before) — excluded
    await seedScrap(jo, new Date('2026-03-01T00:00:00Z'), new Date('2026-03-01T01:00:00Z'), 99)
    // Fully outside (after) — excluded (startTime > to)
    await seedScrap(jo, new Date('2026-03-05T13:30:00Z'), new Date('2026-03-05T14:00:00Z'), 98)

    const result = await findJobOrderRecordsBatch({
      include: ['scrap_entries'],
      items: [
        {
          jobOrderId: jo.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-05T12:00:00Z'),
        },
      ],
    })

    expect(result.quantityAdjustmentsByJobOrderId).toBeUndefined()
    const scraps = result.scrapEntriesByJobOrderId!
    const amounts = scraps[jo.toString()].map(s => s.amount).sort()
    expect(amounts).toEqual([1, 2, 3])
  })

  it('returns both collections when include has both', async () => {
    const jo = new Types.ObjectId()
    await seedQa(jo, new Date('2026-03-05T01:00:00Z'), 5)
    await seedScrap(jo, new Date('2026-03-05T02:00:00Z'), new Date('2026-03-05T03:00:00Z'), 9)

    const result = await findJobOrderRecordsBatch({
      include: ['quantity_adjustments', 'scrap_entries'],
      items: [
        {
          jobOrderId: jo.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-05T12:00:00Z'),
        },
      ],
    })

    expect(result.quantityAdjustmentsByJobOrderId![jo.toString()]).toHaveLength(1)
    expect(result.scrapEntriesByJobOrderId![jo.toString()]).toHaveLength(1)
  })

  it('returns empty groups for jobOrderIds with no records', async () => {
    const jo = new Types.ObjectId()

    const result = await findJobOrderRecordsBatch({
      include: ['quantity_adjustments', 'scrap_entries'],
      items: [
        {
          jobOrderId: jo.toString(),
          from: new Date('2026-03-05T00:00:00Z'),
          to: new Date('2026-03-05T12:00:00Z'),
        },
      ],
    })

    expect(result.quantityAdjustmentsByJobOrderId![jo.toString()]).toEqual([])
    expect(result.scrapEntriesByJobOrderId![jo.toString()]).toEqual([])
  })
})
