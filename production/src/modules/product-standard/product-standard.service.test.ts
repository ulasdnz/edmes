import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JobOrder } from '../job-order/job-order.model.js'
import { Product } from '../product/product.model.js'
import { Uom } from '../uom/uom.model.js'
import { ProductStandard } from './product-standard.model.js'
import * as service from './product-standard.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitProductStandardCreated: vi.fn(),
  emitProductStandardUpdated: vi.fn(),
  emitProductStandardDeleted: vi.fn(),
}))

const mockGetWorkCenterInfo = vi.fn()
vi.mock('../../lib/internal-api.js', () => ({
  getWorkCenterInfo: (...args: unknown[]) => mockGetWorkCenterInfo(...args),
  getUserWorkCenterIds: vi.fn(),
}))

const userId = new Types.ObjectId().toString()
const workCenterId = new Types.ObjectId()
let defaultProductId: string

async function seedProduct() {
  const uom = await Uom.create({ code: `U-${Date.now()}`, name: 'Piece', symbol: 'pc' })
  const product = await Product.create({
    code: `P-${Date.now()}`,
    name: 'Test Product',
    kind: 'finished',
    uomId: uom._id,
  })
  defaultProductId = product._id.toString()
  return defaultProductId
}

const buildInput = (overrides: Record<string, unknown> = {}) => ({
  productId: defaultProductId,
  workCenterId: workCenterId.toString(),
  idealOutputPerMinute: 10,
  ...overrides,
})

// A started job order of the default product on the work center; without an endTime it still runs
const runJobOrder = (startTime: string, endTime: string | null = null) =>
  JobOrder.create({
    code: `JO-${new Types.ObjectId().toHexString().toUpperCase()}`,
    productId: defaultProductId,
    workCenterId,
    targetQuantity: 10,
    startTime: new Date(startTime),
    endTime: endTime ? new Date(endTime) : null,
    startedBy: userId,
    createdBy: userId,
  })

describe('ProductStandardService', () => {
  beforeEach(async () => {
    await seedProduct()
    mockGetWorkCenterInfo.mockReset()
    mockGetWorkCenterInfo.mockResolvedValue({
      type: 'physical',
      productivityMode: 'count_based',
    })
  })

  describe('create', () => {
    it('creates with valid product + physical work center', async () => {
      const doc = await service.create(buildInput({ counterMultiplier: 2 }), userId)

      expect(doc._id).toBeDefined()
      expect(doc.idealOutputPerMinute).toBe(10)
      expect(doc.createdBy.toString()).toBe(userId)
      expect(doc.validFrom).toBeDefined()
    })

    it('defaults validFrom to now when not provided', async () => {
      const before = new Date()
      const doc = await service.create(buildInput({ counterMultiplier: 2 }), userId)
      const after = new Date()

      expect(doc.validFrom.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(doc.validFrom.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('rejects non-physical work center', async () => {
      mockGetWorkCenterInfo.mockResolvedValue({ type: 'virtual' })

      await expect(service.create(buildInput(), userId)).rejects.toThrow(
        'error.work_center_not_physical',
      )
    })

    it('rejects unreachable work center', async () => {
      mockGetWorkCenterInfo.mockResolvedValue(null)

      await expect(service.create(buildInput(), userId)).rejects.toThrow(
        'error.work_center_unreachable',
      )
    })

    it('rejects missing counterMultiplier for count_based work center', async () => {
      mockGetWorkCenterInfo.mockResolvedValue({
        type: 'physical',
        productivityMode: 'count_based',
      })

      await expect(service.create(buildInput(), userId)).rejects.toThrow(
        'error.counter_multiplier_required',
      )
    })

    it('rejects missing idealSpeed for speed_based work center', async () => {
      mockGetWorkCenterInfo.mockResolvedValue({
        type: 'physical',
        productivityMode: 'speed_based',
      })

      await expect(service.create(buildInput(), userId)).rejects.toThrow(
        'error.ideal_speed_required',
      )
    })

    it('rejects non-existent product', async () => {
      const fakeProductId = new Types.ObjectId().toString()

      await expect(
        service.create(buildInput({ productId: fakeProductId, counterMultiplier: 2 }), userId),
      ).rejects.toThrow('error.not_found')
    })

    it('accepts a future validFrom date', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const doc = await service.create(
        buildInput({ counterMultiplier: 2, validFrom: futureDate }),
        userId,
      )

      expect(doc.validFrom.getTime()).toBe(futureDate.getTime())
    })

    it('rejects duplicate productId + workCenterId + validFrom combination', async () => {
      const validFrom = new Date('2026-06-01')
      await service.create(buildInput({ counterMultiplier: 2, validFrom }), userId)

      await expect(
        service.create(buildInput({ counterMultiplier: 3, validFrom }), userId),
      ).rejects.toThrow()
    })

    // Measured production was converted with the standards valid at the time. A standard dated
    // into that period would take it over and silently change OEE already reported.
    it('rejects a standard dated into a running job order', async () => {
      await runJobOrder('2026-02-01T06:00:00Z')

      await expect(
        service.create(
          buildInput({ counterMultiplier: 2, validFrom: new Date('2026-02-01T06:30:00Z') }),
          userId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, message: 'error.product_standard_backdated' })
    })

    it('rejects a standard dated into a finished job order', async () => {
      await runJobOrder('2026-02-01T06:00:00Z', '2026-02-01T14:00:00Z')

      await expect(
        service.create(
          buildInput({ counterMultiplier: 2, validFrom: new Date('2026-02-01T10:00:00Z') }),
          userId,
        ),
      ).rejects.toMatchObject({ statusCode: 409, message: 'error.product_standard_backdated' })
    })

    // A die drops from 4 to 2 parts a stroke during a job order: the new standard applies from now.
    it('accepts a standard valid from now while a job order runs', async () => {
      await runJobOrder('2026-02-01T06:00:00Z')

      const doc = await service.create(buildInput({ counterMultiplier: 2 }), userId)

      expect(doc.counterMultiplier).toBe(2)
    })

    it('accepts a past validFrom when nothing has been produced since', async () => {
      await runJobOrder('2026-02-01T06:00:00Z', '2026-02-01T14:00:00Z')
      const validFrom = new Date('2026-03-01T00:00:00Z')

      const doc = await service.create(buildInput({ counterMultiplier: 2, validFrom }), userId)

      expect(doc.validFrom).toEqual(validFrom)
    })

    it('lets a user who may backdate standards date one into measured production, with a reason', async () => {
      await runJobOrder('2026-02-01T06:00:00Z')
      const backdateReason = 'Two of the four die holes were closed from 06:30'

      const doc = await service.create(
        buildInput({
          counterMultiplier: 2,
          validFrom: new Date('2026-02-01T06:30:00Z'),
          backdateReason,
        }),
        userId,
        { canBackdate: true },
      )

      expect(doc.backdateReason).toBe(backdateReason)
    })

    it('requires a reason to date a standard into measured production', async () => {
      await runJobOrder('2026-02-01T06:00:00Z')

      await expect(
        service.create(
          buildInput({ counterMultiplier: 2, validFrom: new Date('2026-02-01T06:30:00Z') }),
          userId,
          { canBackdate: true },
        ),
      ).rejects.toMatchObject({ statusCode: 400, message: 'error.backdate_reason_required' })
    })

    it('accepts a past validFrom when the next standard took over before production started', async () => {
      await service.create(
        buildInput({ counterMultiplier: 4, validFrom: new Date('2026-03-01T00:00:00Z') }),
        userId,
      )
      await runJobOrder('2026-03-10T06:00:00Z')
      const validFrom = new Date('2026-02-01T00:00:00Z')

      const doc = await service.create(buildInput({ counterMultiplier: 2, validFrom }), userId)

      expect(doc.validFrom).toEqual(validFrom)
    })
  })

  describe('getById', () => {
    it('returns a standard by id', async () => {
      const created = await service.create(buildInput({ counterMultiplier: 2 }), userId)
      const found = await service.getById(created._id.toString())

      expect(found.idealOutputPerMinute).toBe(10)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(service.getById(fakeId)).rejects.toThrow('error.not_found')
    })
  })

  describe('list', () => {
    it('returns paginated results', async () => {
      await service.create(
        buildInput({ counterMultiplier: 2, validFrom: new Date('2026-01-01') }),
        userId,
      )
      await service.create(
        buildInput({
          counterMultiplier: 2,
          validFrom: new Date('2026-02-01'),
          workCenterId: new Types.ObjectId().toString(),
        }),
        userId,
      )

      const result = await service.list({ page: 1, limit: 10 })
      expect(result.data.length).toBe(2)
    })

    it('filters by workCenterId through visibleIds', async () => {
      const wcId2 = new Types.ObjectId().toString()
      await service.create(
        buildInput({ counterMultiplier: 2, validFrom: new Date('2026-01-01') }),
        userId,
      )

      mockGetWorkCenterInfo.mockResolvedValue({ type: 'physical', productivityMode: 'count_based' })
      await service.create(
        buildInput({
          counterMultiplier: 2,
          validFrom: new Date('2026-02-01'),
          workCenterId: wcId2,
        }),
        userId,
      )

      const result = await service.list({ page: 1, limit: 10 }, [workCenterId.toString()])
      expect(result.data.length).toBe(1)
      expect(result.data[0].workCenterId.toString()).toBe(workCenterId.toString())
    })

    it('keeps the list within visibleIds when the client filters by another work center', async () => {
      const hiddenWc = new Types.ObjectId().toString()
      await service.create(buildInput({ counterMultiplier: 2, workCenterId: hiddenWc }), userId)

      const result = await service.list({ page: 1, limit: 10, workCenterId: hiddenWc }, [
        workCenterId.toString(),
      ])

      expect(result.data).toEqual([])
    })

    it('filters by date range (validFromFrom/validFromTo)', async () => {
      await service.create(
        buildInput({ counterMultiplier: 2, validFrom: new Date('2026-01-15') }),
        userId,
      )
      await service.create(
        buildInput({
          counterMultiplier: 2,
          validFrom: new Date('2026-03-15'),
          workCenterId: new Types.ObjectId().toString(),
        }),
        userId,
      )

      const result = await service.list({
        page: 1,
        limit: 10,
        validFromFrom: new Date('2026-01-01'),
        validFromTo: new Date('2026-02-01'),
      })

      expect(result.data.length).toBe(1)
    })
  })

  describe('update', () => {
    it('updates fields when not applied', async () => {
      const created = await service.create(buildInput({ counterMultiplier: 2 }), userId)
      const updated = await service.update(
        created._id.toString(),
        { idealOutputPerMinute: 20 },
        userId,
      )

      expect(updated.idealOutputPerMinute).toBe(20)
      expect(updated.updatedBy?.toString()).toBe(userId)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(service.update(fakeId, { idealOutputPerMinute: 5 }, userId)).rejects.toThrow(
        'error.not_found',
      )
    })

    it('blocks update of an applied standard', async () => {
      const validFrom = new Date('2026-01-01')
      const standard = await service.create(buildInput({ counterMultiplier: 2, validFrom }), userId)

      // Insert a started job order that makes this standard the applicable one
      await JobOrder.create({
        code: `JO-APPLIED-${Date.now()}`,
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-02-01T08:00:00Z'),
        startedBy: userId,
        createdBy: userId,
      })

      await expect(
        service.update(standard._id.toString(), { idealOutputPerMinute: 99 }, userId),
      ).rejects.toThrow('error.product_standard_applied')
    })

    // A die drops from 4 to 2 parts a stroke while a job order runs. The 2-part standard has
    // already converted that job order's strokes, so editing it would rewrite its OEE.
    it('blocks update of a standard that took effect while a started job order was running', async () => {
      await service.create(
        buildInput({ counterMultiplier: 4, validFrom: new Date('2026-01-01T00:00:00Z') }),
        userId,
      )
      const midJob = await service.create(
        buildInput({ counterMultiplier: 2, validFrom: new Date('2026-02-01T06:30:00Z') }),
        userId,
      )
      await runJobOrder('2026-02-01T06:00:00Z')

      await expect(
        service.update(midJob._id.toString(), { counterMultiplier: 3 }, userId),
      ).rejects.toThrow('error.product_standard_applied')
    })

    it('allows update of a standard that takes effect in the future while a job order runs', async () => {
      await service.create(
        buildInput({ counterMultiplier: 4, validFrom: new Date('2026-01-01T00:00:00Z') }),
        userId,
      )
      await JobOrder.create({
        code: `JO-RUNNING-${Date.now()}`,
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-02-01T06:00:00Z'),
        startedBy: userId,
        createdBy: userId,
      })
      const future = await service.create(
        buildInput({ counterMultiplier: 2, validFrom: new Date(Date.now() + 86_400_000) }),
        userId,
      )

      const updated = await service.update(future._id.toString(), { counterMultiplier: 3 }, userId)

      expect(updated.counterMultiplier).toBe(3)
    })

    it('rejects patching idealSpeed to null on a speed_based work center', async () => {
      mockGetWorkCenterInfo.mockResolvedValue({
        type: 'physical',
        productivityMode: 'speed_based',
      })
      const standard = await service.create(buildInput({ idealSpeed: 5 }), userId)

      await expect(
        service.update(standard._id.toString(), { idealSpeed: null }, userId),
      ).rejects.toThrow('error.ideal_speed_required')
    })

    it('rejects unrelated patch when existing idealSpeed is null and WC is speed_based', async () => {
      // Seed a count_based standard (allowed), then simulate WC mode change to speed_based:
      // any subsequent patch must refuse to leave the record in an invalid state.
      const standard = await service.create(buildInput({ counterMultiplier: 2 }), userId)
      mockGetWorkCenterInfo.mockResolvedValue({
        type: 'physical',
        productivityMode: 'speed_based',
      })

      await expect(
        service.update(standard._id.toString(), { idealOutputPerMinute: 25 }, userId),
      ).rejects.toThrow('error.ideal_speed_required')
    })

    it('accepts unrelated patch on speed_based WC when existing idealSpeed is valid', async () => {
      mockGetWorkCenterInfo.mockResolvedValue({
        type: 'physical',
        productivityMode: 'speed_based',
      })
      const standard = await service.create(buildInput({ idealSpeed: 5 }), userId)

      const updated = await service.update(
        standard._id.toString(),
        { idealOutputPerMinute: 25 },
        userId,
      )
      expect(updated.idealOutputPerMinute).toBe(25)
      expect(updated.idealSpeed).toBe(5)
    })

    it('accepts repairing patch that sets idealSpeed when existing was null on speed_based WC', async () => {
      const standard = await service.create(buildInput({ counterMultiplier: 2 }), userId)
      mockGetWorkCenterInfo.mockResolvedValue({
        type: 'physical',
        productivityMode: 'speed_based',
      })

      const updated = await service.update(standard._id.toString(), { idealSpeed: 8 }, userId)
      expect(updated.idealSpeed).toBe(8)
    })

    it('rejects patching counterMultiplier to null on a count_based work center', async () => {
      const standard = await service.create(buildInput({ counterMultiplier: 2 }), userId)
      // default mock is count_based
      await expect(
        service.update(standard._id.toString(), { counterMultiplier: null }, userId),
      ).rejects.toThrow('error.counter_multiplier_required')
    })

    it('rejects unrelated patch when existing counterMultiplier is null and WC is count_based', async () => {
      mockGetWorkCenterInfo.mockResolvedValue({
        type: 'physical',
        productivityMode: 'speed_based',
      })
      const standard = await service.create(buildInput({ idealSpeed: 5 }), userId)
      mockGetWorkCenterInfo.mockResolvedValue({
        type: 'physical',
        productivityMode: 'count_based',
      })

      await expect(
        service.update(standard._id.toString(), { idealOutputPerMinute: 25 }, userId),
      ).rejects.toThrow('error.counter_multiplier_required')
    })
  })

  describe('remove', () => {
    it('deletes when not applied and multiple revisions exist', async () => {
      const s1 = await service.create(
        buildInput({ counterMultiplier: 2, validFrom: new Date('2026-01-01') }),
        userId,
      )
      await service.create(
        buildInput({ counterMultiplier: 3, validFrom: new Date('2026-02-01') }),
        userId,
      )

      const deleted = await service.remove(s1._id.toString())
      expect(deleted._id.toString()).toBe(s1._id.toString())
      expect(await ProductStandard.findById(s1._id)).toBeNull()
    })

    it('allows delete of last revision when no job orders exist', async () => {
      const s1 = await service.create(buildInput({ counterMultiplier: 2 }), userId)

      const deleted = await service.remove(s1._id.toString())
      expect(deleted._id.toString()).toBe(s1._id.toString())
    })

    it('blocks delete of last revision when job orders exist', async () => {
      const s1 = await service.create(buildInput({ counterMultiplier: 2 }), userId)

      await JobOrder.create({
        code: `JO-LAST-REV-${Date.now()}`,
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        createdBy: userId,
      })

      await expect(service.remove(s1._id.toString())).rejects.toThrow(
        'error.product_standard_last_revision',
      )
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(service.remove(fakeId)).rejects.toThrow('error.not_found')
    })

    it('blocks delete of an applied standard', async () => {
      const validFrom = new Date('2026-01-01')
      const standard = await service.create(buildInput({ counterMultiplier: 2, validFrom }), userId)

      // Insert a started job order that makes this standard the applicable one
      await JobOrder.create({
        code: `JO-DEL-APPLIED-${Date.now()}`,
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-02-01T08:00:00Z'),
        startedBy: userId,
        createdBy: userId,
      })

      await expect(service.remove(standard._id.toString())).rejects.toThrow(
        'error.product_standard_applied',
      )
    })

    it('blocks delete of a standard that took effect while a started job order was running', async () => {
      await service.create(
        buildInput({ counterMultiplier: 4, validFrom: new Date('2026-01-01T00:00:00Z') }),
        userId,
      )
      const midJob = await service.create(
        buildInput({ counterMultiplier: 2, validFrom: new Date('2026-02-01T06:30:00Z') }),
        userId,
      )
      await runJobOrder('2026-02-01T06:00:00Z', '2026-02-01T14:00:00Z')

      await expect(service.remove(midJob._id.toString())).rejects.toThrow(
        'error.product_standard_applied',
      )
    })
  })
})
