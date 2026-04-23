import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'

const { cacheDel, cacheWrap } = vi.hoisted(() => ({
  cacheDel: vi.fn(async () => {}),
  cacheWrap: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()),
}))

vi.mock('../../lib/cache.js', () => ({
  cacheDel,
  cacheWrap,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDelPattern: vi.fn(),
  cacheWrapDedup: vi.fn(),
  sharedCacheWrapDedup: vi.fn(),
  sharedCacheDel: vi.fn(),
}))

import { PerformanceRuntimePolicy } from './policy.model.js'
import * as service from './policy.service.js'
import { policyUpdateSchema } from './policy.validators.js'

const userId = new Types.ObjectId().toString()

describe('PolicyService', () => {
  describe('getFactory', () => {
    it('returns defaults when no factory record exists', async () => {
      const policy = await service.getFactory()
      expect(policy.runModeDebounceMs).toBe(0)
      expect(policy.microStopThresholdMs).toBe(120_000)
      expect(policy.actualOutputWindowMode).toBe('execution_span')
      expect(policy.productivityAggregationMode).toBe('total_ratio')
      expect(policy.allowProductivityOver100).toBe(true)
    })

    it('returns stored factory record when present', async () => {
      await service.upsertFactory({ runModeDebounceMs: 5000 }, userId)
      const policy = await service.getFactory()
      expect(policy.runModeDebounceMs).toBe(5000)
    })
  })

  describe('getForWorkCenter', () => {
    it('falls back to factory default when WC override missing', async () => {
      await service.upsertFactory({ microStopThresholdMs: 60_000 }, userId)
      const wcId = new Types.ObjectId().toString()
      const policy = await service.getForWorkCenter(wcId)
      expect(policy.microStopThresholdMs).toBe(60_000)
    })

    it('returns WC override when present', async () => {
      await service.upsertFactory({ microStopThresholdMs: 60_000 }, userId)
      const wcId = new Types.ObjectId().toString()
      await service.upsertForWorkCenter(wcId, { microStopThresholdMs: 30_000 }, userId)
      const policy = await service.getForWorkCenter(wcId)
      expect(policy.microStopThresholdMs).toBe(30_000)
    })
  })

  describe('upsertFactory', () => {
    it('creates and then updates factory row', async () => {
      const created = await service.upsertFactory({ runModeDebounceMs: 0 }, userId)
      expect(created.workCenterId).toBeNull()

      const updated = await service.upsertFactory({ runModeDebounceMs: 7000 }, userId)
      expect(updated.runModeDebounceMs).toBe(7000)

      const rows = await PerformanceRuntimePolicy.find({ workCenterId: null }).lean()
      expect(rows.length).toBe(1)
    })

    it('invalidates factory cache on upsert', async () => {
      cacheDel.mockClear()
      await service.upsertFactory({ runModeDebounceMs: 10 }, userId)
      expect(cacheDel).toHaveBeenCalledWith('policy:factory')
    })
  })

  describe('upsertForWorkCenter', () => {
    it('creates WC override', async () => {
      const wcId = new Types.ObjectId().toString()
      const doc = await service.upsertForWorkCenter(wcId, { runModeDebounceMs: 4000 }, userId)
      expect(doc.workCenterId?.toString()).toBe(wcId)
      expect(doc.runModeDebounceMs).toBe(4000)
    })

    it('invalidates both factory and WC caches', async () => {
      const wcId = new Types.ObjectId().toString()
      cacheDel.mockClear()
      await service.upsertForWorkCenter(wcId, { runModeDebounceMs: 2 }, userId)
      expect(cacheDel).toHaveBeenCalledWith('policy:factory')
      expect(cacheDel).toHaveBeenCalledWith(`policy:wc:${wcId}`)
    })

    it('handles concurrent WC upserts without unique-index conflict', async () => {
      const wcId = new Types.ObjectId().toString()
      await Promise.all([
        service.upsertForWorkCenter(wcId, { runModeDebounceMs: 1 }, userId),
        service.upsertForWorkCenter(wcId, { runModeDebounceMs: 2 }, userId),
      ])

      const rows = await PerformanceRuntimePolicy.find({
        workCenterId: new Types.ObjectId(wcId),
      }).lean()
      expect(rows.length).toBe(1)
    })
  })

  describe('enum values', () => {
    it('accepts actualOutputWindowMode="net_run_segments"', async () => {
      const doc = await service.upsertFactory(
        { actualOutputWindowMode: 'net_run_segments' },
        userId,
      )
      expect(doc.actualOutputWindowMode).toBe('net_run_segments')
    })

    it('accepts productivityAggregationMode="run_time_weighted_ratio"', async () => {
      const doc = await service.upsertFactory(
        { productivityAggregationMode: 'run_time_weighted_ratio' },
        userId,
      )
      expect(doc.productivityAggregationMode).toBe('run_time_weighted_ratio')
    })

    it('rejects legacy actualOutputWindowMode="run_time" at validator level', () => {
      const result = policyUpdateSchema.safeParse({ actualOutputWindowMode: 'run_time' })
      expect(result.success).toBe(false)
    })

    it('rejects legacy productivityAggregationMode="time_weighted" at validator level', () => {
      const result = policyUpdateSchema.safeParse({
        productivityAggregationMode: 'time_weighted',
      })
      expect(result.success).toBe(false)
    })

    it('rejects legacy actualOutputWindowMode="run_time" at model level', async () => {
      await expect(
        PerformanceRuntimePolicy.create({
          workCenterId: null,
          actualOutputWindowMode: 'run_time',
          createdBy: new Types.ObjectId(userId),
        } as unknown as Parameters<typeof PerformanceRuntimePolicy.create>[0]),
      ).rejects.toThrow(/is not a valid enum value/i)
    })
  })

  describe('removeForWorkCenter', () => {
    it('removes the WC override', async () => {
      const wcId = new Types.ObjectId().toString()
      await service.upsertForWorkCenter(wcId, { runModeDebounceMs: 1 }, userId)
      await service.removeForWorkCenter(wcId)
      const remaining = await PerformanceRuntimePolicy.find({
        workCenterId: new Types.ObjectId(wcId),
      }).lean()
      expect(remaining.length).toBe(0)
    })

    it('returns 404 when nothing to remove', async () => {
      await expect(
        service.removeForWorkCenter(new Types.ObjectId().toString()),
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})
