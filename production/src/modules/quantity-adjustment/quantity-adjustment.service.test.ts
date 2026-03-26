import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { JobOrder } from '../job-order/job-order.model.js'
import { QuantityAdjustment } from './quantity-adjustment.model.js'
import * as qaService from './quantity-adjustment.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitQuantityAdjustmentCreated: vi.fn(),
  emitQuantityAdjustmentUpdated: vi.fn(),
  emitQuantityAdjustmentDeleted: vi.fn(),
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
      const jo2 = await createStartedJobOrder({ code: `JO-F2-${Date.now()}` })
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
  })
})
