import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import {
  emitScrapEntryCreated,
  emitScrapEntryDeleted,
  emitScrapEntryUpdated,
} from '../../jobs/events.js'
import { JobOrder } from '../job-order/job-order.model.js'
import { ScrapEntry } from './scrap-entry.model.js'
import * as scrapService from './scrap-entry.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitScrapEntryCreated: vi.fn(),
  emitScrapEntryUpdated: vi.fn(),
  emitScrapEntryDeleted: vi.fn(),
}))

vi.mock('../../lib/internal-api.js', () => ({
  assertShiftExists: vi.fn().mockResolvedValue(undefined),
  getWorkCenterInfo: vi.fn().mockResolvedValue(null),
}))

const wcId = new Types.ObjectId()
const productId = new Types.ObjectId()
const shiftId = new Types.ObjectId()
const reasonId = new Types.ObjectId()
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
  amount: 3,
  startTime: new Date('2026-03-01T09:00:00Z'),
  endTime: new Date('2026-03-01T10:00:00Z'),
  reasonId: reasonId.toString(),
  ...overrides,
})

describe('ScrapEntryService', () => {
  describe('create', () => {
    it('creates a scrap entry for a started job order', async () => {
      const jo = await createStartedJobOrder()
      const doc = await scrapService.create(buildInput(jo._id.toString()), userId)

      expect(doc._id).toBeDefined()
      expect(doc.amount).toBe(3)
      expect(doc.workCenterId.toString()).toBe(wcId.toString())
      expect(doc.productId.toString()).toBe(productId.toString())
      expect(doc.reasonId?.toString()).toBe(reasonId.toString())
      expect(doc.createdBy.toString()).toBe(userId)
    })

    it('throws 404 for non-existent job order', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(scrapService.create(buildInput(fakeId), userId)).rejects.toThrow(
        'error.not_found',
      )
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

      await expect(scrapService.create(buildInput(jo._id.toString()), userId)).rejects.toThrow(
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
        scrapService.create(buildInput(jo._id.toString()), userId, [wcId.toString()]),
      ).rejects.toThrow('error.not_found')
    })

    it('throws 400 if endTime <= startTime', async () => {
      const jo = await createStartedJobOrder()
      await expect(
        scrapService.create(
          buildInput(jo._id.toString(), {
            startTime: new Date('2026-03-01T10:00:00Z'),
            endTime: new Date('2026-03-01T09:00:00Z'),
          }),
          userId,
        ),
      ).rejects.toThrow('error.scrap_end_before_start')
    })

    it('throws 400 if startTime is before job order start', async () => {
      const jo = await createStartedJobOrder()
      await expect(
        scrapService.create(
          buildInput(jo._id.toString(), {
            startTime: new Date('2026-02-28T00:00:00Z'),
            endTime: new Date('2026-03-01T10:00:00Z'),
          }),
          userId,
        ),
      ).rejects.toThrow('error.job_order_time_before_start')
    })

    it('allows creation for a finished job order', async () => {
      const jo = await createStartedJobOrder({
        endTime: new Date('2026-03-02T16:00:00Z'),
        endedBy: new Types.ObjectId(),
      })

      const doc = await scrapService.create(buildInput(jo._id.toString()), userId)

      expect(doc._id).toBeDefined()
      expect(doc.amount).toBe(3)
    })

    it('throws 400 if amount is zero', async () => {
      const jo = await createStartedJobOrder()
      await expect(
        scrapService.create(buildInput(jo._id.toString(), { amount: 0 }), userId),
      ).rejects.toThrow('error.amount_not_positive')
    })

    it('throws 400 if amount is negative', async () => {
      const jo = await createStartedJobOrder()
      await expect(
        scrapService.create(buildInput(jo._id.toString(), { amount: -1 }), userId),
      ).rejects.toThrow('error.amount_not_positive')
    })

    it('throws 400 if endTime equals startTime (strict: endTime > startTime required)', async () => {
      const jo = await createStartedJobOrder()
      const sameTime = new Date('2026-03-01T09:00:00Z')
      await expect(
        scrapService.create(
          buildInput(jo._id.toString(), { startTime: sameTime, endTime: sameTime }),
          userId,
        ),
      ).rejects.toThrow('error.scrap_end_before_start')
    })

    it('allows startTime exactly at job order startTime (boundary)', async () => {
      const jo = await createStartedJobOrder()
      const doc = await scrapService.create(
        buildInput(jo._id.toString(), {
          startTime: joStart,
          endTime: new Date('2026-03-01T10:00:00Z'),
        }),
        userId,
      )

      expect(doc.startTime.getTime()).toBe(joStart.getTime())
    })
  })

  describe('getById', () => {
    it('returns a scrap entry by id', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)
      const found = await scrapService.getById(created._id.toString())

      expect(found.amount).toBe(3)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(scrapService.getById(fakeId)).rejects.toThrow('error.not_found')
    })
  })

  describe('list', () => {
    it('returns paginated results', async () => {
      const jo = await createStartedJobOrder()
      await scrapService.create(buildInput(jo._id.toString(), { amount: 1 }), userId)
      await scrapService.create(
        buildInput(jo._id.toString(), {
          amount: 2,
          startTime: new Date('2026-03-01T11:00:00Z'),
          endTime: new Date('2026-03-01T12:00:00Z'),
        }),
        userId,
      )

      const result = await scrapService.list({ page: 1, limit: 10 })

      expect(result.data.length).toBe(2)
      expect(result.pagination.total).toBe(2)
    })

    it('filters by jobOrderId', async () => {
      const jo1 = await createStartedJobOrder({ code: `JO-F1-${Date.now()}` })
      const jo2 = await createStartedJobOrder({ code: `JO-F2-${Date.now()}` })
      await scrapService.create(buildInput(jo1._id.toString()), userId)
      await scrapService.create(buildInput(jo2._id.toString()), userId)

      const result = await scrapService.list({
        page: 1,
        limit: 10,
        jobOrderId: jo1._id.toString(),
      })

      expect(result.data.length).toBe(1)
    })

    it('filters by reasonId', async () => {
      const jo = await createStartedJobOrder()
      const otherReasonId = new Types.ObjectId()
      await scrapService.create(buildInput(jo._id.toString()), userId)
      await scrapService.create(
        buildInput(jo._id.toString(), {
          reasonId: otherReasonId.toString(),
          startTime: new Date('2026-03-01T11:00:00Z'),
          endTime: new Date('2026-03-01T12:00:00Z'),
        }),
        userId,
      )

      const result = await scrapService.list({
        page: 1,
        limit: 10,
        reasonId: reasonId.toString(),
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0]?.reasonId?.toString()).toBe(reasonId.toString())
    })

    it('filters by visibleIds (work center scoping)', async () => {
      const otherWc = new Types.ObjectId()
      const jo1 = await createStartedJobOrder({ code: `JO-V1-${Date.now()}` })
      const jo2 = await createStartedJobOrder({
        code: `JO-V2-${Date.now()}`,
        workCenterId: otherWc,
      })
      await scrapService.create(buildInput(jo1._id.toString()), userId)
      await scrapService.create(buildInput(jo2._id.toString()), userId)

      const result = await scrapService.list({ page: 1, limit: 10 }, [wcId.toString()])

      expect(result.data.length).toBe(1)
    })

    it('keeps the list within visibleIds when the client filters by another work center', async () => {
      const hiddenWc = new Types.ObjectId()
      const hidden = await createStartedJobOrder({
        code: `JO-HIDDEN-${Date.now()}`,
        workCenterId: hiddenWc,
      })
      await scrapService.create(buildInput(hidden._id.toString()), userId)

      const result = await scrapService.list(
        { page: 1, limit: 10, workCenterId: hiddenWc.toString() },
        [wcId.toString()],
      )

      expect(result.data).toEqual([])
    })

    it('filters by startTime date range', async () => {
      const jo = await createStartedJobOrder()
      await scrapService.create(
        buildInput(jo._id.toString(), {
          startTime: new Date('2026-03-10T09:00:00Z'),
          endTime: new Date('2026-03-10T10:00:00Z'),
        }),
        userId,
      )
      await scrapService.create(
        buildInput(jo._id.toString(), {
          startTime: new Date('2026-03-20T09:00:00Z'),
          endTime: new Date('2026-03-20T10:00:00Z'),
        }),
        userId,
      )

      const result = await scrapService.list({
        page: 1,
        limit: 10,
        startTimeFrom: new Date('2026-03-15'),
        startTimeTo: new Date('2026-03-25'),
      })

      expect(result.data.length).toBe(1)
    })
  })

  describe('update', () => {
    it('updates fields via patch', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)
      const updated = await scrapService.update(created._id.toString(), { amount: 10 }, userId)

      expect(updated.amount).toBe(10)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(scrapService.update(fakeId, { amount: 1 }, userId)).rejects.toThrow(
        'error.not_found',
      )
    })

    it('rejects update when scrap entry work center is not visible', async () => {
      const otherWc = new Types.ObjectId()
      const jo = await createStartedJobOrder({
        code: `JO-UV-${Date.now()}`,
        workCenterId: otherWc,
      })
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)

      await expect(
        scrapService.update(created._id.toString(), { amount: 10 }, userId, [wcId.toString()]),
      ).rejects.toThrow('error.not_found')
    })

    it('throws 400 if updated endTime <= startTime', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)

      await expect(
        scrapService.update(
          created._id.toString(),
          { endTime: new Date('2026-03-01T08:30:00Z') },
          userId,
        ),
      ).rejects.toThrow('error.scrap_end_before_start')
    })

    it('throws 400 if updated startTime is before job order start', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)

      await expect(
        scrapService.update(
          created._id.toString(),
          { startTime: new Date('2026-02-28T00:00:00Z') },
          userId,
        ),
      ).rejects.toThrow('error.job_order_time_before_start')
    })
  })

  describe('remove', () => {
    it('deletes a scrap entry', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)
      const deleted = await scrapService.remove(created._id.toString())

      expect(deleted._id.toString()).toBe(created._id.toString())
      expect(await ScrapEntry.findById(created._id)).toBeNull()
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(scrapService.remove(fakeId)).rejects.toThrow('error.not_found')
    })

    it('rejects remove when scrap entry work center is not visible', async () => {
      const otherWc = new Types.ObjectId()
      const jo = await createStartedJobOrder({
        code: `JO-RV-${Date.now()}`,
        workCenterId: otherWc,
      })
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)

      await expect(scrapService.remove(created._id.toString(), [wcId.toString()])).rejects.toThrow(
        'error.not_found',
      )
    })
  })

  // ── Emit verification ────────────────────────────────────────────────

  describe('ScrapEntryEmit.create', () => {
    it('calls emitScrapEntryCreated with id, jobOrderId, workCenterId as strings', async () => {
      const jo = await createStartedJobOrder()
      const doc = await scrapService.create(buildInput(jo._id.toString()), userId)

      expect(emitScrapEntryCreated).toHaveBeenCalledWith(
        doc._id.toString(),
        doc.jobOrderId.toString(),
        doc.workCenterId.toString(),
      )
    })

    it('passes all three params as strings via .toString()', async () => {
      const jo = await createStartedJobOrder()
      const _doc = await scrapService.create(buildInput(jo._id.toString()), userId)
      const args = vi.mocked(emitScrapEntryCreated).mock.calls[0]

      expect(typeof args[0]).toBe('string')
      expect(typeof args[1]).toBe('string')
      expect(typeof args[2]).toBe('string')
    })
  })

  describe('ScrapEntryEmit.update', () => {
    it('calls emitScrapEntryUpdated with id and pre-update routing fields', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)
      vi.mocked(emitScrapEntryUpdated).mockClear()

      await scrapService.update(created._id.toString(), { amount: 10 }, userId)

      expect(emitScrapEntryUpdated).toHaveBeenCalledWith(
        created._id.toString(),
        created.jobOrderId.toString(),
        created.workCenterId.toString(),
      )
    })

    it('uses pre-update document for routing fields, not post-update', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)
      vi.mocked(emitScrapEntryUpdated).mockClear()

      await scrapService.update(created._id.toString(), { amount: 99 }, userId)

      const args = vi.mocked(emitScrapEntryUpdated).mock.calls[0]
      expect(args[1]).toBe(created.jobOrderId.toString())
      expect(args[2]).toBe(created.workCenterId.toString())
    })
  })

  describe('ScrapEntryEmit.remove', () => {
    it('calls emitScrapEntryDeleted with id and routing fields from fetched doc', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)
      vi.mocked(emitScrapEntryDeleted).mockClear()

      await scrapService.remove(created._id.toString())

      expect(emitScrapEntryDeleted).toHaveBeenCalledWith(
        created._id.toString(),
        created.jobOrderId.toString(),
        created.workCenterId.toString(),
      )
    })

    it('reads routing fields from the document fetched before deletion', async () => {
      const jo = await createStartedJobOrder()
      const created = await scrapService.create(buildInput(jo._id.toString()), userId)
      vi.mocked(emitScrapEntryDeleted).mockClear()

      await scrapService.remove(created._id.toString())

      expect(emitScrapEntryDeleted).toHaveBeenCalledOnce()
      const args = vi.mocked(emitScrapEntryDeleted).mock.calls[0]
      expect(args[1]).toBe(jo._id.toString())
      expect(args[2]).toBe(wcId.toString())
    })
  })
})
