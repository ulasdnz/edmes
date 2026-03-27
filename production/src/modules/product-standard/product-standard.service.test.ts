import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
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
      expect(updated.updatedBy.toString()).toBe(userId)
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
  })
})
