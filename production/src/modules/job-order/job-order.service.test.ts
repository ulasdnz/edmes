import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { Product } from '../product/product.model.js'
import { ProductStandard } from '../product-standard/product-standard.model.js'
import { ProductionPlan } from '../production-plan/production-plan.model.js'
import { Uom } from '../uom/uom.model.js'
import { JobOrder } from './job-order.model.js'
import * as service from './job-order.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitJobOrderCreated: vi.fn(),
  emitJobOrderUpdated: vi.fn(),
  emitJobOrderStarted: vi.fn(),
  emitJobOrderEnded: vi.fn(),
  emitJobOrderDeleted: vi.fn(),
}))

const mockGetWorkCenterInfo = vi.fn()
vi.mock('../../lib/internal-api.js', () => ({
  getWorkCenterInfo: (...args: unknown[]) => mockGetWorkCenterInfo(...args),
  getUserWorkCenterIds: vi.fn(),
}))

const userId = new Types.ObjectId().toString()
const workCenterId = new Types.ObjectId()
let defaultProductId: string

async function seed() {
  const uom = await Uom.create({ code: `U-${Date.now()}`, name: 'Piece', symbol: 'pc' })
  const product = await Product.create({
    code: `P-${Date.now()}`,
    name: 'Test Product',
    kind: 'finished',
    uomId: uom._id,
  })
  defaultProductId = product._id.toString()

  await ProductStandard.create({
    productId: product._id,
    workCenterId,
    validFrom: new Date('2020-01-01'),
    idealOutputPerMinute: 10,
    counterMultiplier: 2,
    createdBy: userId,
  })
}

const buildInput = (overrides: Record<string, unknown> = {}) => ({
  code: `JO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  productId: defaultProductId,
  workCenterId: workCenterId.toString(),
  targetQuantity: 50,
  ...overrides,
})

describe('JobOrderService', () => {
  beforeEach(async () => {
    mockGetWorkCenterInfo.mockReset()
    mockGetWorkCenterInfo.mockResolvedValue({ type: 'physical', productivityMode: 'count_based' })
    await seed()
  })

  // ── CRUD ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates with valid data', async () => {
      const doc = await service.create(buildInput(), userId)

      expect(doc._id).toBeDefined()
      expect(doc.startTime).toBeNull()
      expect(doc.endTime).toBeNull()
      expect(doc.createdBy.toString()).toBe(userId)
    })

    it('rejects non-existent product', async () => {
      await expect(
        service.create(buildInput({ productId: new Types.ObjectId().toString() }), userId),
      ).rejects.toThrow('error.not_found')
    })

    it('rejects non-physical work center', async () => {
      mockGetWorkCenterInfo.mockResolvedValue({ type: 'virtual' })
      await expect(service.create(buildInput(), userId)).rejects.toThrow(
        'error.work_center_not_physical',
      )
    })

    it('rejects when no applicable standard exists', async () => {
      await ProductStandard.deleteMany({})
      await expect(service.create(buildInput(), userId)).rejects.toThrow(
        'error.job_order_no_standard',
      )
    })

    it('validates parent plan constraints', async () => {
      const plan = await ProductionPlan.create({
        code: 'PP-CONSTRAINT',
        productId: defaultProductId,
        targetQuantity: 30,
        createdBy: userId,
      })

      await expect(
        service.create(
          buildInput({ productionPlanId: plan._id.toString(), targetQuantity: 50 }),
          userId,
        ),
      ).rejects.toThrow('error.plan_target_exceeded')
    })
  })

  describe('update', () => {
    it('updates fields before start', async () => {
      const jo = await service.create(buildInput(), userId)
      const updated = await service.update(jo._id.toString(), { targetQuantity: 100 }, userId)

      expect(updated.targetQuantity).toBe(100)
    })

    it('blocks forbidden fields after start', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      await expect(service.update(jo._id.toString(), { code: 'NEW-CODE' }, userId)).rejects.toThrow(
        'error.immutable_field',
      )
    })

    it('allows dueAt/description/props after start', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      const updated = await service.update(
        jo._id.toString(),
        { description: 'Updated desc' },
        userId,
      )
      expect(updated.description).toBe('Updated desc')
    })
  })

  describe('remove', () => {
    it('deletes when not started', async () => {
      const jo = await service.create(buildInput(), userId)
      const deleted = await service.remove(jo._id.toString())

      expect(deleted._id.toString()).toBe(jo._id.toString())
      expect(await JobOrder.findById(jo._id)).toBeNull()
    })

    it('blocks delete after start', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      await expect(service.remove(jo._id.toString())).rejects.toThrow(
        'error.job_order_started_no_delete',
      )
    })
  })

  // ── Start Lifecycle ─────────────────────────────────────────────────────

  describe('start', () => {
    it('starts with default now', async () => {
      const jo = await service.create(buildInput(), userId)
      const before = new Date()
      const started = await service.start(jo._id.toString(), {}, userId)
      const after = new Date()

      expect(started.startTime).toBeDefined()
      expect(started.startTime!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(started.startTime!.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(started.startedBy!.toString()).toBe(userId)
    })

    it('starts with backdated startTime', async () => {
      const jo = await service.create(buildInput(), userId)
      const pastDate = new Date('2026-03-01')
      const started = await service.start(jo._id.toString(), { startTime: pastDate }, userId)

      expect(started.startTime!.getTime()).toBe(pastDate.getTime())
    })

    it('rejects future startTime', async () => {
      const jo = await service.create(buildInput(), userId)
      const future = new Date(Date.now() + 86400000)

      await expect(service.start(jo._id.toString(), { startTime: future }, userId)).rejects.toThrow(
        'error.job_order_start_future',
      )
    })

    it('rejects already started', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      await expect(service.start(jo._id.toString(), {}, userId)).rejects.toThrow(
        'error.job_order_already_started',
      )
    })

    it('rejects when another active job on same WC', async () => {
      const jo1 = await service.create(buildInput({ code: 'JO-ACTIVE-1' }), userId)
      const jo2 = await service.create(buildInput({ code: 'JO-ACTIVE-2' }), userId)

      await service.start(jo1._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      await expect(
        service.start(jo2._id.toString(), { startTime: new Date('2026-03-02') }, userId),
      ).rejects.toThrow('error.job_order_active_exists')
    })

    it('rejects when no applicable standard', async () => {
      await ProductStandard.deleteMany({})
      // Re-create a standard with future validFrom
      await ProductStandard.create({
        productId: defaultProductId,
        workCenterId,
        validFrom: new Date('2099-01-01'),
        idealOutputPerMinute: 10,
        counterMultiplier: 2,
        createdBy: userId,
      })
      // Need a standard with validFrom <= now for create
      await ProductStandard.create({
        productId: defaultProductId,
        workCenterId,
        validFrom: new Date('2020-01-01'),
        idealOutputPerMinute: 10,
        counterMultiplier: 2,
        createdBy: userId,
      })

      const jo = await service.create(buildInput(), userId)
      // Now remove the old standard, only future one remains
      await ProductStandard.deleteMany({ validFrom: new Date('2020-01-01') })

      await expect(
        service.start(jo._id.toString(), { startTime: new Date('2025-06-01') }, userId),
      ).rejects.toThrow('error.job_order_no_standard')
    })

    it('rejects overlap with finished job', async () => {
      const jo1 = await service.create(buildInput({ code: 'JO-FIN-1' }), userId)
      await service.start(
        jo1._id.toString(),
        { startTime: new Date('2026-03-01T08:00:00Z') },
        userId,
      )
      await service.end(jo1._id.toString(), { endTime: new Date('2026-03-01T16:00:00Z') }, userId)

      const jo2 = await service.create(buildInput({ code: 'JO-OVERLAP' }), userId)

      await expect(
        service.start(jo2._id.toString(), { startTime: new Date('2026-03-01T12:00:00Z') }, userId),
      ).rejects.toThrow('error.job_order_overlap')
    })

    it('allows start after finished job ends', async () => {
      const jo1 = await service.create(buildInput({ code: 'JO-DONE-1' }), userId)
      await service.start(
        jo1._id.toString(),
        { startTime: new Date('2026-03-01T08:00:00Z') },
        userId,
      )
      await service.end(jo1._id.toString(), { endTime: new Date('2026-03-01T16:00:00Z') }, userId)

      const jo2 = await service.create(buildInput({ code: 'JO-AFTER' }), userId)
      const started = await service.start(
        jo2._id.toString(),
        { startTime: new Date('2026-03-01T16:00:00Z') },
        userId,
      )

      expect(started.startTime).toBeDefined()
    })
  })

  // ── End Lifecycle ───────────────────────────────────────────────────────

  describe('end', () => {
    it('ends with default now', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      const before = new Date()
      const ended = await service.end(jo._id.toString(), {}, userId)
      const after = new Date()

      expect(ended.endTime!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(ended.endTime!.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(ended.endedBy!.toString()).toBe(userId)
    })

    it('rejects if not started', async () => {
      const jo = await service.create(buildInput(), userId)

      await expect(service.end(jo._id.toString(), {}, userId)).rejects.toThrow(
        'error.job_order_not_started',
      )
    })

    it('rejects if already ended', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId)
      await service.end(jo._id.toString(), { endTime: new Date('2026-03-02') }, userId)

      await expect(service.end(jo._id.toString(), {}, userId)).rejects.toThrow(
        'error.job_order_already_ended',
      )
    })

    it('rejects endTime before startTime', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-10') }, userId)

      await expect(
        service.end(jo._id.toString(), { endTime: new Date('2026-03-05') }, userId),
      ).rejects.toThrow('error.job_order_end_before_start')
    })

    it('rejects future endTime', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      const future = new Date(Date.now() + 86400000)
      await expect(service.end(jo._id.toString(), { endTime: future }, userId)).rejects.toThrow(
        'error.job_order_end_future',
      )
    })
  })

  // ── Advanced Filters ──────────────────────────────────────────────────

  describe('list', () => {
    it('filters by runtimeState pending', async () => {
      await service.create(buildInput({ code: 'JO-P1' }), userId)
      const jo2 = await service.create(buildInput({ code: 'JO-R1' }), userId)
      await service.start(jo2._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      const result = await service.list({ page: 1, limit: 10, runtimeState: 'pending' })
      expect(result.data.length).toBe(1)
      expect(result.data[0].code).toBe('JO-P1')
    })

    it('filters by runtimeState running', async () => {
      await service.create(buildInput({ code: 'JO-P2' }), userId)
      const jo2 = await service.create(buildInput({ code: 'JO-R2' }), userId)
      await service.start(jo2._id.toString(), { startTime: new Date('2026-03-01') }, userId)

      const result = await service.list({ page: 1, limit: 10, runtimeState: 'running' })
      expect(result.data.length).toBe(1)
      expect(result.data[0].code).toBe('JO-R2')
    })

    it('filters by runtimeState finished', async () => {
      await service.create(buildInput({ code: 'JO-P3' }), userId)
      const jo2 = await service.create(buildInput({ code: 'JO-F1' }), userId)
      await service.start(jo2._id.toString(), { startTime: new Date('2026-03-01') }, userId)
      await service.end(jo2._id.toString(), { endTime: new Date('2026-03-02') }, userId)

      const result = await service.list({ page: 1, limit: 10, runtimeState: 'finished' })
      expect(result.data.length).toBe(1)
      expect(result.data[0].code).toBe('JO-F1')
    })

    it('filters by visibleIds', async () => {
      const wcId2 = new Types.ObjectId()
      await service.create(buildInput({ code: 'JO-V1' }), userId)

      await ProductStandard.create({
        productId: defaultProductId,
        workCenterId: wcId2,
        validFrom: new Date('2020-01-01'),
        idealOutputPerMinute: 10,
        counterMultiplier: 2,
        createdBy: userId,
      })
      await service.create(buildInput({ code: 'JO-V2', workCenterId: wcId2.toString() }), userId)

      const result = await service.list({ page: 1, limit: 10 }, [workCenterId.toString()])
      expect(result.data.length).toBe(1)
      expect(result.data[0].code).toBe('JO-V1')
    })

    it('supports search across code and description', async () => {
      await service.create(buildInput({ code: 'JO-SRCH-1', description: 'Alpha batch' }), userId)
      await service.create(buildInput({ code: 'JO-SRCH-2', description: 'Beta batch' }), userId)

      const result = await service.list({ page: 1, limit: 10, search: 'Alpha' })
      expect(result.data.length).toBe(1)
    })
  })
})
