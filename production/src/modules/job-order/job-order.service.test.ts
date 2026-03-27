import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { Product } from '../product/product.model.js'
import { ProductStandard } from '../product-standard/product-standard.model.js'
import { ProductionPlan } from '../production-plan/production-plan.model.js'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'
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

    it('rejects when productId does not match parent plan productId', async () => {
      const uom2 = await Uom.create({ code: `U2-${Date.now()}`, name: 'Box', symbol: 'bx' })
      const otherProduct = await Product.create({
        code: `P2-${Date.now()}`,
        name: 'Other Product',
        kind: 'finished',
        uomId: uom2._id,
      })
      const plan = await ProductionPlan.create({
        code: `PP-MISMATCH-${Date.now()}`,
        productId: otherProduct._id,
        targetQuantity: 100,
        createdBy: userId,
      })

      await expect(
        service.create(
          buildInput({ productionPlanId: plan._id.toString(), targetQuantity: 10 }),
          userId,
        ),
      ).rejects.toThrow('error.plan_product_mismatch')
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

    it('rejects updating workCenterId to a non-physical work center pre-start', async () => {
      mockGetWorkCenterInfo.mockResolvedValueOnce({
        type: 'physical',
        productivityMode: 'count_based',
      })
      const jo = await service.create(buildInput(), userId)

      mockGetWorkCenterInfo.mockResolvedValueOnce({ type: 'virtual' })
      const newWcId = new Types.ObjectId().toString()

      await expect(
        service.update(jo._id.toString(), { workCenterId: newWcId }, userId),
      ).rejects.toThrow('error.work_center_not_physical')
    })

    it('rejects updating productId to a non-existent product pre-start', async () => {
      const jo = await service.create(buildInput(), userId)
      const fakeProductId = new Types.ObjectId().toString()

      await expect(
        service.update(jo._id.toString(), { productId: fakeProductId }, userId),
      ).rejects.toThrow('error.not_found')
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

    it('blocks delete when QuantityAdjustment records reference the job order', async () => {
      const jo = await service.create(buildInput(), userId)
      await QuantityAdjustment.create({
        jobOrderId: jo._id,
        workCenterId: workCenterId,
        productId: jo.productId,
        shiftId: new Types.ObjectId(),
        amount: 5,
        time: new Date(),
        createdBy: userId,
      })

      await expect(service.remove(jo._id.toString())).rejects.toThrow('error.referenced')
    })

    it('blocks delete when ScrapEntry records reference the job order', async () => {
      const jo = await service.create(buildInput(), userId)
      await ScrapEntry.create({
        jobOrderId: jo._id,
        workCenterId: workCenterId,
        productId: jo.productId,
        shiftId: new Types.ObjectId(),
        amount: 2,
        startTime: new Date('2026-03-01T09:00:00Z'),
        endTime: new Date('2026-03-01T10:00:00Z'),
        createdBy: userId,
      })

      await expect(service.remove(jo._id.toString())).rejects.toThrow('error.referenced')
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

    it('rejects start when work center not in visibleIds', async () => {
      const jo = await service.create(buildInput(), userId)
      const unrelatedWcId = new Types.ObjectId().toString()

      await expect(
        service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId, [
          unrelatedWcId,
        ]),
      ).rejects.toThrow('error.not_found')
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

    it('rejects end when work center not in visibleIds', async () => {
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime: new Date('2026-03-01') }, userId)
      const unrelatedWcId = new Types.ObjectId().toString()

      await expect(
        service.end(jo._id.toString(), { endTime: new Date('2026-03-02') }, userId, [
          unrelatedWcId,
        ]),
      ).rejects.toThrow('error.not_found')
    })

    it('allows endTime equal to startTime (boundary: endTime >= startTime)', async () => {
      const startTime = new Date('2026-03-01T10:00:00Z')
      const jo = await service.create(buildInput(), userId)
      await service.start(jo._id.toString(), { startTime }, userId)

      const ended = await service.end(jo._id.toString(), { endTime: startTime }, userId)
      expect(ended.endTime!.getTime()).toBe(startTime.getTime())
    })

    it('rejects backdated endTime that would overlap another finished job on same work center', async () => {
      // Set up: a finished job on the same work center (inserted directly to bypass service)
      // JO_OTHER ran 09:00-11:00 on the same work center
      await JobOrder.create({
        code: `JO-OTHER-${Date.now()}`,
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-03-01T09:00:00Z'),
        endTime: new Date('2026-03-01T11:00:00Z'),
        startedBy: userId,
        endedBy: userId,
        createdBy: userId,
      })

      // JO_CURRENT started at 08:00 (before the other job — inserted directly)
      const joCurrent = await JobOrder.create({
        code: `JO-CURRENT-${Date.now()}`,
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-03-01T08:00:00Z'),
        startedBy: userId,
        createdBy: userId,
      })

      // Try to end joCurrent at 10:00, which overlaps the other job's [09:00-11:00] interval
      await expect(
        service.end(
          joCurrent._id.toString(),
          { endTime: new Date('2026-03-01T10:00:00Z') },
          userId,
        ),
      ).rejects.toThrow('error.job_order_overlap')
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

    it('filters by workCenterIds (comma-separated multi-value)', async () => {
      const wcId2 = new Types.ObjectId()
      await ProductStandard.create({
        productId: defaultProductId,
        workCenterId: wcId2,
        validFrom: new Date('2020-01-01'),
        idealOutputPerMinute: 10,
        counterMultiplier: 2,
        createdBy: userId,
      })

      await service.create(buildInput({ code: 'JO-MWC-1' }), userId)
      await service.create(buildInput({ code: 'JO-MWC-2', workCenterId: wcId2.toString() }), userId)

      const unrelatedWcId = new Types.ObjectId().toString()
      const result = await service.list({
        page: 1,
        limit: 10,
        workCenterIds: `${workCenterId.toString()},${unrelatedWcId}`,
      })
      expect(result.data.every(d => d.workCenterId.toString() === workCenterId.toString())).toBe(
        true,
      )
      expect(result.data.length).toBe(1)
    })

    it('filters by productIds (comma-separated multi-value)', async () => {
      const uom2 = await Uom.create({ code: `U3-${Date.now()}`, name: 'Kg', symbol: 'kg' })
      const product2 = await Product.create({
        code: `P3-${Date.now()}`,
        name: 'Product 2',
        kind: 'semi_finished',
        uomId: uom2._id,
      })
      await ProductStandard.create({
        productId: product2._id,
        workCenterId,
        validFrom: new Date('2020-01-01'),
        idealOutputPerMinute: 5,
        counterMultiplier: 1,
        createdBy: userId,
      })

      await service.create(buildInput({ code: 'JO-MPID-1' }), userId)
      await service.create(
        buildInput({ code: 'JO-MPID-2', productId: product2._id.toString() }),
        userId,
      )

      const result = await service.list({
        page: 1,
        limit: 10,
        productIds: `${defaultProductId},${product2._id.toString()}`,
      })
      expect(result.data.length).toBe(2)
    })

    it('filters by activeFrom: returns jobs whose interval extends past activeFrom', async () => {
      // Direct DB inserts to test filter logic without triggering lifecycle constraints
      await JobOrder.create({
        code: 'JO-AF-RUN',
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-03-01T08:00:00Z'),
        startedBy: userId,
        createdBy: userId,
      })
      await JobOrder.create({
        code: 'JO-AF-OLD',
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-02-01T08:00:00Z'),
        endTime: new Date('2026-02-01T16:00:00Z'),
        startedBy: userId,
        endedBy: userId,
        createdBy: userId,
      })
      await JobOrder.create({
        code: 'JO-AF-PND',
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        createdBy: userId,
      })

      const activeFrom = new Date('2026-03-01T00:00:00Z')
      const result = await service.list({ page: 1, limit: 10, activeFrom })

      const codes = result.data.map(d => d.code)
      expect(codes).toContain('JO-AF-RUN')
      expect(codes).not.toContain('JO-AF-OLD')
      expect(codes).not.toContain('JO-AF-PND')
    })

    it('filters by activeTo: returns jobs that started before activeTo', async () => {
      await JobOrder.create({
        code: 'JO-AT-1',
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-02-01T08:00:00Z'),
        endTime: new Date('2026-02-01T16:00:00Z'),
        startedBy: userId,
        endedBy: userId,
        createdBy: userId,
      })
      await JobOrder.create({
        code: 'JO-AT-2',
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-03-10T08:00:00Z'),
        startedBy: userId,
        createdBy: userId,
      })

      const activeTo = new Date('2026-03-01T00:00:00Z')
      const result = await service.list({ page: 1, limit: 10, activeTo })

      const codes = result.data.map(d => d.code)
      expect(codes).toContain('JO-AT-1')
      expect(codes).not.toContain('JO-AT-2')
    })

    it('filters by activeFrom+activeTo together: returns jobs whose interval intersects the window', async () => {
      // JO spans [Mar 1, Mar 5] — intersects [Mar 3, Mar 10] window
      await JobOrder.create({
        code: 'JO-WIN-1',
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-03-01T08:00:00Z'),
        endTime: new Date('2026-03-05T16:00:00Z'),
        startedBy: userId,
        endedBy: userId,
        createdBy: userId,
      })
      // JO spans [Mar 7, Mar 8] — within window
      await JobOrder.create({
        code: 'JO-WIN-2',
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-03-07T08:00:00Z'),
        endTime: new Date('2026-03-08T16:00:00Z'),
        startedBy: userId,
        endedBy: userId,
        createdBy: userId,
      })
      // JO spans [Feb 1, Feb 2] — entirely before window
      await JobOrder.create({
        code: 'JO-WIN-3',
        productId: defaultProductId,
        workCenterId,
        targetQuantity: 10,
        startTime: new Date('2026-02-01T08:00:00Z'),
        endTime: new Date('2026-02-02T16:00:00Z'),
        startedBy: userId,
        endedBy: userId,
        createdBy: userId,
      })

      const result = await service.list({
        page: 1,
        limit: 10,
        activeFrom: new Date('2026-03-03T00:00:00Z'),
        activeTo: new Date('2026-03-10T00:00:00Z'),
      })

      const codes = result.data.map(d => d.code)
      expect(codes).toContain('JO-WIN-1')
      expect(codes).toContain('JO-WIN-2')
      expect(codes).not.toContain('JO-WIN-3')
    })
  })
})
