import { readFileSync } from 'node:fs'
import { CustomError } from '@mes/core'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cache, cacheDel, cacheWrap } = vi.hoisted(() => {
  // Keeps a value as JSON until its key is deleted, as the Redis cache does
  const cache = new Map<string, string>()
  return {
    cache,
    cacheDel: vi.fn(async (key: string) => {
      cache.delete(key)
    }),
    cacheWrap: vi.fn(async (key: string, _ttl: number, loader: () => Promise<unknown>) => {
      const hit = cache.get(key)
      if (hit !== undefined) return JSON.parse(hit)
      const value = await loader()
      if (value !== null && value !== undefined) cache.set(key, JSON.stringify(value))
      return value
    }),
  }
})

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

const { getWorkCenter } = vi.hoisted(() => ({
  getWorkCenter: vi.fn(async (_id: string): Promise<{ code?: string } | null> => null),
}))

vi.mock('../../lib/internal-api/work-center.client.js', () => ({
  getById: getWorkCenter,
  invalidate: vi.fn(),
}))

import { PerformanceRuntimePolicy } from './policy.model.js'
import * as service from './policy.service.js'
import { policyUpdateSchema, policyWorkCenterUpdateSchema } from './policy.validators.js'

const userId = new Types.ObjectId().toString()

describe('PolicyService', () => {
  beforeEach(() => {
    cache.clear()
    getWorkCenter.mockReset()
    getWorkCenter.mockResolvedValue(null)
  })

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

    it('keeps the factory value of a field the work center does not set', async () => {
      await service.upsertFactory({ runModeDebounceMs: 5000 }, userId)
      const wcId = new Types.ObjectId().toString()
      await service.upsertForWorkCenter(wcId, { microStopThresholdMs: 60_000 }, userId)

      const policy = await service.getForWorkCenter(wcId)

      expect(policy.microStopThresholdMs).toBe(60_000)
      expect(policy.runModeDebounceMs).toBe(5000)
    })

    it('follows a factory change in a field the work center does not set', async () => {
      const wcId = new Types.ObjectId().toString()
      await service.upsertForWorkCenter(wcId, { microStopThresholdMs: 60_000 }, userId)
      await service.getForWorkCenter(wcId)

      await service.upsertFactory({ runModeDebounceMs: 8000 }, userId)

      expect((await service.getForWorkCenter(wcId)).runModeDebounceMs).toBe(8000)
    })

    it('shows a factory change at once to a work center read before it', async () => {
      const wcId = new Types.ObjectId().toString()
      await service.getForWorkCenter(wcId)

      await service.upsertFactory({ runModeDebounceMs: 8000 }, userId)

      expect((await service.getForWorkCenter(wcId)).runModeDebounceMs).toBe(8000)
    })

    it('hands a field back to the factory when the work center sets it to null', async () => {
      await service.upsertFactory({ runModeDebounceMs: 5000 }, userId)
      const wcId = new Types.ObjectId().toString()
      await service.upsertForWorkCenter(wcId, { runModeDebounceMs: 3000 }, userId)

      await service.upsertForWorkCenter(wcId, { runModeDebounceMs: null }, userId)

      expect((await service.getForWorkCenter(wcId)).runModeDebounceMs).toBe(5000)
    })
  })

  describe('validators', () => {
    it('takes null for a work center field and refuses it for the factory', () => {
      expect(policyWorkCenterUpdateSchema.safeParse({ runModeDebounceMs: null }).success).toBe(true)
      expect(policyUpdateSchema.safeParse({ runModeDebounceMs: null }).success).toBe(false)
    })
  })

  // A stop shorter than the debounce is never recorded, so a debounce that reaches the micro stop
  // threshold leaves no stop to classify as a micro stop
  describe('debounce and micro stop threshold', () => {
    const brokenRule = { statusCode: 400, message: 'error.debounce_not_below_micro_stop' }

    it('refuses a work center debounce that reaches its micro stop threshold', async () => {
      const wcId = new Types.ObjectId().toString()

      await expect(
        service.upsertForWorkCenter(wcId, { runModeDebounceMs: 120_000 }, userId),
      ).rejects.toMatchObject(brokenRule)
      expect(
        await PerformanceRuntimePolicy.countDocuments({ workCenterId: new Types.ObjectId(wcId) }),
      ).toBe(0)
    })

    it('refuses a threshold not above the debounce the work center inherits', async () => {
      await service.upsertFactory({ runModeDebounceMs: 30_000 }, userId)
      const wcId = new Types.ObjectId().toString()

      await expect(
        service.upsertForWorkCenter(wcId, { microStopThresholdMs: 30_000 }, userId),
      ).rejects.toMatchObject(brokenRule)
    })

    it('checks a field handed back to the factory against the factory value', async () => {
      await service.upsertFactory({ microStopThresholdMs: 60_000 }, userId)
      const wcId = new Types.ObjectId().toString()
      await service.upsertForWorkCenter(
        wcId,
        { runModeDebounceMs: 100_000, microStopThresholdMs: 150_000 },
        userId,
      )

      await expect(
        service.upsertForWorkCenter(wcId, { microStopThresholdMs: null }, userId),
      ).rejects.toMatchObject(brokenRule)
    })

    it('takes any debounce once a work center turns micro stops off', async () => {
      const wcId = new Types.ObjectId().toString()

      const policy = await service.upsertForWorkCenter(
        wcId,
        { runModeDebounceMs: 300_000, microStopThresholdMs: 0 },
        userId,
      )

      expect(policy.runModeDebounceMs).toBe(300_000)
    })

    it('refuses a factory debounce that reaches the factory threshold', async () => {
      await expect(
        service.upsertFactory({ runModeDebounceMs: 120_000 }, userId),
      ).rejects.toMatchObject(brokenRule)
    })

    it('refuses a factory change that breaks a work center inheriting from it', async () => {
      const wcId = new Types.ObjectId().toString()
      await service.upsertForWorkCenter(wcId, { microStopThresholdMs: 30_000 }, userId)
      getWorkCenter.mockResolvedValueOnce({ code: 'PRS/01' })

      await expect(
        service.upsertFactory({ runModeDebounceMs: 30_000 }, userId),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.debounce_not_below_micro_stop_on_work_centers',
        details: { workCenterIds: [wcId], workCenters: 'PRS/01' },
      })
      expect((await service.getFactory()).runModeDebounceMs).toBe(0)
    })

    it('names a work center it cannot read by its id', async () => {
      const wcId = new Types.ObjectId().toString()
      await service.upsertForWorkCenter(wcId, { microStopThresholdMs: 30_000 }, userId)
      getWorkCenter.mockRejectedValueOnce(new CustomError(503, 'error.work_center_unreachable'))

      await expect(
        service.upsertFactory({ runModeDebounceMs: 30_000 }, userId),
      ).rejects.toMatchObject({ details: { workCenters: wcId } })
    })

    it('puts the work centers into both translations of the message', () => {
      for (const language of ['en', 'tr']) {
        const file = new URL(`../../../locales/${language}/translation.json`, import.meta.url)
        const translation = JSON.parse(readFileSync(file, 'utf8'))
        expect(translation.error.debounce_not_below_micro_stop_on_work_centers).toContain(
          '{{workCenters}}',
        )
      }
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
