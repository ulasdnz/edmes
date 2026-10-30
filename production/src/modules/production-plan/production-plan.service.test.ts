import { profileOperations } from '@mes/testing'
import mongoose, { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { Product } from '../product/product.model.js'
import { Uom } from '../uom/uom.model.js'
import { ProductionPlan } from './production-plan.model.js'
import * as service from './production-plan.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitProductionPlanCreated: vi.fn(),
  emitProductionPlanUpdated: vi.fn(),
  emitProductionPlanDeleted: vi.fn(),
}))

const userId = new Types.ObjectId().toString()
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
}

const buildInput = (overrides: Record<string, unknown> = {}) => ({
  code: `PP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  productId: defaultProductId,
  targetQuantity: 100,
  ...overrides,
})

// Register a minimal JobOrder model for constraint tests
const joSchema = new mongoose.Schema({
  productionPlanId: { type: mongoose.Schema.Types.ObjectId },
  productId: { type: mongoose.Schema.Types.ObjectId },
  workCenterId: { type: mongoose.Schema.Types.ObjectId },
  targetQuantity: { type: Number },
})
let JobOrder: mongoose.Model<any>
try {
  JobOrder = mongoose.model('JobOrder')
} catch {
  JobOrder = mongoose.model('JobOrder', joSchema)
}

describe('ProductionPlanService', () => {
  beforeEach(async () => {
    await seedProduct()
  })

  describe('create', () => {
    it('creates a plan with valid data', async () => {
      const doc = await service.create(buildInput(), userId)

      expect(doc._id).toBeDefined()
      expect(doc.code).toMatch(/^PP-/)
      expect(doc.targetQuantity).toBe(100)
      expect(doc.createdBy.toString()).toBe(userId)
    })

    it('rejects non-existent productId', async () => {
      const fakeId = new Types.ObjectId().toString()

      await expect(service.create(buildInput({ productId: fakeId }), userId)).rejects.toThrow(
        'error.not_found',
      )
    })

    it('rejects duplicate code', async () => {
      const data = buildInput({ code: 'DUPE-PP' })
      await service.create(data, userId)

      await expect(service.create(data, userId)).rejects.toThrow()
    })
  })

  describe('getById', () => {
    it('returns a plan by id', async () => {
      const created = await service.create(buildInput(), userId)
      const found = await service.getById(created._id.toString())

      expect(found.code).toBe(created.code)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(service.getById(fakeId)).rejects.toThrow('error.not_found')
    })
  })

  describe('list', () => {
    it('returns paginated results', async () => {
      await service.create(buildInput({ code: 'LP-1' }), userId)
      await service.create(buildInput({ code: 'LP-2' }), userId)

      const result = await service.list({ page: 1, limit: 10 })

      expect(result.data.length).toBe(2)
      expect(result.pagination.total).toBe(2)
    })

    it('searches codes by prefix and lists matches in code order, never descriptions', async () => {
      await service.create(buildInput({ code: 'SEARCH-1', description: 'Alpha batch' }), userId)
      await service.create(buildInput({ code: 'SEARCH-2', description: 'Beta batch' }), userId)

      const byPrefix = await service.list({ page: 1, limit: 10, search: 'search' })
      const inside = await service.list({ page: 1, limit: 10, search: 'EARCH-1' })
      const byDescription = await service.list({ page: 1, limit: 10, search: 'Alpha' })

      expect(byPrefix.data.map(plan => plan.code)).toEqual(['SEARCH-1', 'SEARCH-2'])
      expect(inside.data).toEqual([])
      expect(byDescription.data).toEqual([])
    })
  })

  describe('update', () => {
    it('updates fields when no children exist', async () => {
      const created = await service.create(buildInput(), userId)
      const updated = await service.update(created._id.toString(), { targetQuantity: 200 }, userId)

      expect(updated.targetQuantity).toBe(200)
      expect(updated.updatedBy.toString()).toBe(userId)
    })

    it('blocks productId change when children exist', async () => {
      const plan = await service.create(buildInput(), userId)
      await JobOrder.create({
        productionPlanId: plan._id,
        productId: defaultProductId,
        workCenterId: new Types.ObjectId(),
        targetQuantity: 10,
      })

      const newProductId = new Types.ObjectId().toString()
      await expect(
        service.update(plan._id.toString(), { productId: newProductId }, userId),
      ).rejects.toThrow('error.plan_immutable_field')
    })

    it('blocks code change when children exist', async () => {
      const plan = await service.create(buildInput(), userId)
      await JobOrder.create({
        productionPlanId: plan._id,
        productId: defaultProductId,
        workCenterId: new Types.ObjectId(),
        targetQuantity: 10,
      })

      await expect(
        service.update(plan._id.toString(), { code: 'NEW-CODE' }, userId),
      ).rejects.toThrow('error.plan_immutable_field')
    })

    it('blocks targetQuantity below child sum', async () => {
      const plan = await service.create(buildInput({ targetQuantity: 100 }), userId)
      await JobOrder.create({
        productionPlanId: plan._id,
        productId: defaultProductId,
        workCenterId: new Types.ObjectId(),
        targetQuantity: 60,
      })
      await JobOrder.create({
        productionPlanId: plan._id,
        productId: defaultProductId,
        workCenterId: new Types.ObjectId(),
        targetQuantity: 30,
      })

      await expect(
        service.update(plan._id.toString(), { targetQuantity: 80 }, userId),
      ).rejects.toThrow('error.plan_target_exceeded')
    })

    it('allows targetQuantity equal to child sum', async () => {
      const plan = await service.create(buildInput({ targetQuantity: 100 }), userId)
      await JobOrder.create({
        productionPlanId: plan._id,
        productId: defaultProductId,
        workCenterId: new Types.ObjectId(),
        targetQuantity: 50,
      })

      const updated = await service.update(plan._id.toString(), { targetQuantity: 50 }, userId)

      expect(updated.targetQuantity).toBe(50)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(service.update(fakeId, { targetQuantity: 10 }, userId)).rejects.toThrow(
        'error.not_found',
      )
    })
  })

  describe('remove', () => {
    it('deletes when no children exist', async () => {
      const created = await service.create(buildInput(), userId)
      const deleted = await service.remove(created._id.toString())

      expect(deleted._id.toString()).toBe(created._id.toString())
      expect(await ProductionPlan.findById(created._id)).toBeNull()
    })

    it('blocks delete when children exist', async () => {
      const plan = await service.create(buildInput(), userId)
      await JobOrder.create({
        productionPlanId: plan._id,
        productId: defaultProductId,
        workCenterId: new Types.ObjectId(),
        targetQuantity: 10,
      })

      await expect(service.remove(plan._id.toString())).rejects.toThrow('error.referenced')
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(service.remove(fakeId)).rejects.toThrow('error.not_found')
    })
  })
})

describe('ProductionPlanService list index', () => {
  it('pages plans from the creation index, newest first', async () => {
    await ProductionPlan.createIndexes()
    await ProductionPlan.collection.insertMany(
      Array.from({ length: 1000 }, (_, i) => ({
        code: `PLAN-${String(i).padStart(4, '0')}`,
        productId: new Types.ObjectId(),
        targetQuantity: 10,
        createdBy: new Types.ObjectId(userId),
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    )

    const { result, operations } = await profileOperations(
      ProductionPlan.collection.collectionName,
      () => service.list({ page: 1, limit: 20 }),
    )

    expect(result.data[0].code).toBe('PLAN-0999')
    const find = operations.find(op => op.op === 'query')
    expect(find?.planSummary).toBe('IXSCAN { createdAt: -1, _id: -1 }')
    expect(find?.keysExamined).toBeLessThanOrEqual(21)
  })
})
