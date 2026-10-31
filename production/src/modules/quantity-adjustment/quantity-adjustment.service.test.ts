import { profileOperations } from '@mes/testing'
import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import {
  emitQuantityAdjustmentCreated,
  emitQuantityAdjustmentDeleted,
  emitQuantityAdjustmentUpdated,
} from '../../jobs/events.js'
import { JobOrder } from '../job-order/job-order.model.js'
import { QuantityAdjustment } from './quantity-adjustment.model.js'
import * as qaService from './quantity-adjustment.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitQuantityAdjustmentCreated: vi.fn(),
  emitQuantityAdjustmentUpdated: vi.fn(),
  emitQuantityAdjustmentDeleted: vi.fn(),
}))

vi.mock('../../lib/internal-api.js', () => ({
  assertShiftExists: vi.fn().mockResolvedValue(undefined),
  getWorkCenterInfo: vi.fn().mockResolvedValue(null),
}))

const wcId = new Types.ObjectId()
const productId = new Types.ObjectId()
const shiftId = new Types.ObjectId()
const userId = new Types.ObjectId().toString()

const joStart = new Date('2026-03-01T08:00:00Z')

async function createStartedJobOrder(overrides: Record<string, unknown> = {}) {
  return JobOrder.create({
    code: `JO-${Date.now()}`,
    productId,
    workCenterId: wcId,
    targetQuantity: 100,
    plannedStartAt: joStart,
    dueAt: new Date('2026-04-01'),
    startTime: joStart,
    startedBy: new Types.ObjectId(),
    createdBy: new Types.ObjectId(),
    ...overrides,
  })
}

const buildInput = (jobOrderId: string, overrides: Record<string, unknown> = {}) => ({
  jobOrderId,
  shiftId: shiftId.toString(),
  amount: 5,
  time: new Date('2026-03-01T10:00:00Z'),
  ...overrides,
})

describe('QuantityAdjustmentService', () => {
  describe('create', () => {
    it('creates an adjustment for a started job order', async () => {
      const jo = await createStartedJobOrder()
      const doc = await qaService.create(buildInput(jo._id.toString()), userId)

      expect(doc._id).toBeDefined()
      expect(doc.amount).toBe(5)
      expect(doc.workCenterId.toString()).toBe(wcId.toString())
      expect(doc.productId.toString()).toBe(productId.toString())
      expect(doc.createdBy.toString()).toBe(userId)
    })

    it('throws 404 for non-existent job order', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(qaService.create(buildInput(fakeId), userId)).rejects.toThrow('error.not_found')
    })

    it('throws 400 if job order not started', async () => {
      const jo = await JobOrder.create({
        code: `JO-NS-${Date.now()}`,
        productId,
        workCenterId: wcId,
        targetQuantity: 100,
        plannedStartAt: joStart,
        dueAt: new Date('2026-04-01'),
        createdBy: new Types.ObjectId(),
      })

      await expect(qaService.create(buildInput(jo._id.toString()), userId)).rejects.toThrow(
        'error.job_order_not_started_for_adjustment',
      )
    })

    it('rejects create when job order work center is not visible', async () => {
      const otherWc = new Types.ObjectId()
      const jo = await createStartedJobOrder({
        code: `JO-CV-${Date.now()}`,
        workCenterId: otherWc,
      })

      await expect(
        qaService.create(buildInput(jo._id.toString()), userId, [wcId.toString()]),
      ).rejects.toThrow('error.not_found')
    })

    it('throws 400 if amount is zero', async () => {
      const jo = await createStartedJobOrder()
      await expect(
        qaService.create(buildInput(jo._id.toString(), { amount: 0 }), userId),
      ).rejects.toThrow('error.amount_zero')
    })

    it('allows negative amount (scrap deduction)', async () => {
      const jo = await createStartedJobOrder()
      const doc = await qaService.create(buildInput(jo._id.toString(), { amount: -3 }), userId)

      expect(doc.amount).toBe(-3)
    })

    it('throws 400 if time is before job order start', async () => {
      const jo = await createStartedJobOrder()
      const earlyTime = new Date('2026-02-28T00:00:00Z')
      await expect(
        qaService.create(buildInput(jo._id.toString(), { time: earlyTime }), userId),
      ).rejects.toThrow('error.job_order_time_before_start')
    })

    it('allows creation for a finished job order', async () => {
      const jo = await createStartedJobOrder({
        endTime: new Date('2026-03-02T16:00:00Z'),
        endedBy: new Types.ObjectId(),
      })

      const doc = await qaService.create(buildInput(jo._id.toString()), userId)

      expect(doc._id).toBeDefined()
      expect(doc.amount).toBe(5)
    })

    it('allows time exactly at job order startTime (boundary)', async () => {
      const jo = await createStartedJobOrder()
      const doc = await qaService.create(buildInput(jo._id.toString(), { time: joStart }), userId)

      expect(doc.time.getTime()).toBe(joStart.getTime())
    })
  })

  describe('getById', () => {
    it('returns an adjustment by id', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)
      const found = await qaService.getById(created._id.toString())

      expect(found.amount).toBe(5)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(qaService.getById(fakeId)).rejects.toThrow('error.not_found')
    })
  })

  describe('list', () => {
    it('returns paginated results', async () => {
      const jo = await createStartedJobOrder()
      await qaService.create(buildInput(jo._id.toString(), { amount: 1 }), userId)
      await qaService.create(buildInput(jo._id.toString(), { amount: 2 }), userId)

      const result = await qaService.list({ page: 1, limit: 10 })

      expect(result.data.length).toBe(2)
      expect(result.pagination.total).toBe(2)
    })

    it('filters by jobOrderId', async () => {
      const jo1 = await createStartedJobOrder({ code: `JO-F1-${Date.now()}` })
      // A work center runs one job order at a time
      const jo2 = await createStartedJobOrder({
        code: `JO-F2-${Date.now()}`,
        workCenterId: new Types.ObjectId(),
      })
      await qaService.create(buildInput(jo1._id.toString()), userId)
      await qaService.create(buildInput(jo2._id.toString()), userId)

      const result = await qaService.list({
        page: 1,
        limit: 10,
        jobOrderId: jo1._id.toString(),
      })

      expect(result.data.length).toBe(1)
    })

    it('filters by visibleIds (work center scoping)', async () => {
      const otherWc = new Types.ObjectId()
      const jo1 = await createStartedJobOrder({ code: `JO-V1-${Date.now()}` })
      const jo2 = await createStartedJobOrder({
        code: `JO-V2-${Date.now()}`,
        workCenterId: otherWc,
      })
      await qaService.create(buildInput(jo1._id.toString()), userId)
      await qaService.create(buildInput(jo2._id.toString()), userId)

      const result = await qaService.list({ page: 1, limit: 10 }, [wcId.toString()])

      expect(result.data.length).toBe(1)
    })

    it('keeps the list within visibleIds when the client filters by another work center', async () => {
      const hiddenWc = new Types.ObjectId()
      const hidden = await createStartedJobOrder({
        code: `JO-HIDDEN-${Date.now()}`,
        workCenterId: hiddenWc,
      })
      await qaService.create(buildInput(hidden._id.toString()), userId)

      const result = await qaService.list(
        { page: 1, limit: 10, workCenterId: hiddenWc.toString() },
        [wcId.toString()],
      )

      expect(result.data).toEqual([])
    })

    it('filters by date range', async () => {
      const jo = await createStartedJobOrder()
      await qaService.create(
        buildInput(jo._id.toString(), { time: new Date('2026-03-10T10:00:00Z') }),
        userId,
      )
      await qaService.create(
        buildInput(jo._id.toString(), { time: new Date('2026-03-20T10:00:00Z') }),
        userId,
      )

      const result = await qaService.list({
        page: 1,
        limit: 10,
        timeFrom: new Date('2026-03-15'),
        timeTo: new Date('2026-03-25'),
      })

      expect(result.data.length).toBe(1)
    })
  })

  describe('update', () => {
    it('updates fields via patch', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)
      const updated = await qaService.update(created._id.toString(), { amount: 10 }, userId)

      expect(updated.amount).toBe(10)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(qaService.update(fakeId, { amount: 1 }, userId)).rejects.toThrow(
        'error.not_found',
      )
    })

    it('rejects update when adjustment work center is not visible', async () => {
      const otherWc = new Types.ObjectId()
      const jo = await createStartedJobOrder({
        code: `JO-UV-${Date.now()}`,
        workCenterId: otherWc,
      })
      const created = await qaService.create(buildInput(jo._id.toString()), userId)

      await expect(
        qaService.update(created._id.toString(), { amount: 10 }, userId, [wcId.toString()]),
      ).rejects.toThrow('error.not_found')
    })

    it('throws 400 if updated amount is zero', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)

      await expect(qaService.update(created._id.toString(), { amount: 0 }, userId)).rejects.toThrow(
        'error.amount_zero',
      )
    })

    it('throws 400 if updated time is before job order start', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)
      const earlyTime = new Date('2026-02-28T00:00:00Z')

      await expect(
        qaService.update(created._id.toString(), { time: earlyTime }, userId),
      ).rejects.toThrow('error.job_order_time_before_start')
    })
  })

  describe('remove', () => {
    it('deletes an adjustment', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)
      const deleted = await qaService.remove(created._id.toString())

      expect(deleted._id.toString()).toBe(created._id.toString())
      expect(await QuantityAdjustment.findById(created._id)).toBeNull()
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(qaService.remove(fakeId)).rejects.toThrow('error.not_found')
    })

    it('rejects remove when adjustment work center is not visible', async () => {
      const otherWc = new Types.ObjectId()
      const jo = await createStartedJobOrder({
        code: `JO-RV-${Date.now()}`,
        workCenterId: otherWc,
      })
      const created = await qaService.create(buildInput(jo._id.toString()), userId)

      await expect(qaService.remove(created._id.toString(), [wcId.toString()])).rejects.toThrow(
        'error.not_found',
      )
    })
  })

  // ── Emit verification ────────────────────────────────────────────────

  describe('QuantityAdjustmentEmit.create', () => {
    it('calls emitQuantityAdjustmentCreated with id, jobOrderId, workCenterId as strings', async () => {
      const jo = await createStartedJobOrder()
      const doc = await qaService.create(buildInput(jo._id.toString()), userId)

      expect(emitQuantityAdjustmentCreated).toHaveBeenCalledWith(
        doc._id.toString(),
        doc.jobOrderId.toString(),
        doc.workCenterId.toString(),
      )
    })

    it('passes all three params as strings via .toString()', async () => {
      const jo = await createStartedJobOrder()
      const _doc = await qaService.create(buildInput(jo._id.toString()), userId)
      const args = vi.mocked(emitQuantityAdjustmentCreated).mock.calls[0]

      expect(typeof args[0]).toBe('string')
      expect(typeof args[1]).toBe('string')
      expect(typeof args[2]).toBe('string')
    })
  })

  describe('QuantityAdjustmentEmit.update', () => {
    it('calls emitQuantityAdjustmentUpdated with id and pre-update routing fields', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)
      vi.mocked(emitQuantityAdjustmentUpdated).mockClear()

      await qaService.update(created._id.toString(), { amount: 10 }, userId)

      expect(emitQuantityAdjustmentUpdated).toHaveBeenCalledWith(
        created._id.toString(),
        created.jobOrderId.toString(),
        created.workCenterId.toString(),
      )
    })

    it('uses pre-update document for routing fields, not post-update', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)
      vi.mocked(emitQuantityAdjustmentUpdated).mockClear()

      await qaService.update(created._id.toString(), { amount: 99 }, userId)

      const args = vi.mocked(emitQuantityAdjustmentUpdated).mock.calls[0]
      expect(args[1]).toBe(created.jobOrderId.toString())
      expect(args[2]).toBe(created.workCenterId.toString())
    })
  })

  describe('QuantityAdjustmentEmit.remove', () => {
    it('calls emitQuantityAdjustmentDeleted with id and routing fields from fetched doc', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)
      vi.mocked(emitQuantityAdjustmentDeleted).mockClear()

      await qaService.remove(created._id.toString())

      expect(emitQuantityAdjustmentDeleted).toHaveBeenCalledWith(
        created._id.toString(),
        created.jobOrderId.toString(),
        created.workCenterId.toString(),
      )
    })

    it('reads routing fields from the document fetched before deletion', async () => {
      const jo = await createStartedJobOrder()
      const created = await qaService.create(buildInput(jo._id.toString()), userId)
      vi.mocked(emitQuantityAdjustmentDeleted).mockClear()

      await qaService.remove(created._id.toString())

      expect(emitQuantityAdjustmentDeleted).toHaveBeenCalledOnce()
      const args = vi.mocked(emitQuantityAdjustmentDeleted).mock.calls[0]
      expect(args[1]).toBe(jo._id.toString())
      expect(args[2]).toBe(wcId.toString())
    })
  })
})

describe('QuantityAdjustmentService list index', () => {
  it("pages the adjustments of the caller's work centers from an index, newest first", async () => {
    await QuantityAdjustment.createIndexes()
    const workCenters = Array.from({ length: 12 }, () => new Types.ObjectId())
    await QuantityAdjustment.collection.insertMany(
      workCenters.flatMap((workCenterId, w) =>
        Array.from({ length: 100 }, (_, i) => ({
          jobOrderId: new Types.ObjectId(),
          workCenterId,
          productId,
          shiftId,
          amount: 1,
          time: joStart,
          createdBy: new Types.ObjectId(userId),
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, w * 100 + i)),
        })),
      ),
    )

    const { result, operations } = await profileOperations(
      QuantityAdjustment.collection.collectionName,
      () => qaService.list({ page: 1, limit: 20 }, workCenters.slice(0, 3).map(String)),
    )

    expect(result.data).toHaveLength(20)
    const find = operations.find(op => op.op === 'query')
    expect(find?.planSummary).toContain('IXSCAN { workCenterId: 1, createdAt: -1, _id: -1 }')
    expect(find?.hasSortStage).toBeFalsy()
    expect(find?.keysExamined).toBeLessThanOrEqual(3 * 21)
  })
})
