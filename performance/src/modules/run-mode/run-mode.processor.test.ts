import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cacheStore = new Map<string, unknown>()

const { cacheGet, cacheSet, cacheDel, cacheWrap, cacheWrapDedup } = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    cacheGet: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    cacheSet: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    cacheDel: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    cacheWrap: vi.fn(async (_k: string, _t: number, loader: () => Promise<unknown>) => loader()),
    cacheWrapDedup: vi.fn(async (_k: string, _t: number, loader: () => Promise<unknown>) =>
      loader(),
    ),
    __store: store,
  }
})

vi.mock('../../lib/cache.js', () => ({
  cacheDel,
  cacheGet,
  cacheSet,
  cacheWrap,
  cacheWrapDedup,
  cacheDelPattern: vi.fn(),
  sharedCacheWrapDedup: vi.fn(),
  sharedCacheDel: vi.fn(),
}))

const { getLatest } = vi.hoisted(() => ({
  getLatest: vi.fn(async () => null as null | { tagId: string; value: number; occurredAt: string }),
}))
vi.mock('../../lib/internal-api/telemetry.client.js', () => ({
  getLatest,
  getStateDurations: vi.fn(),
}))

const { getWorkCenter } = vi.hoisted(() => ({
  getWorkCenter: vi.fn(async () => null as unknown as { _id: string } | null),
}))
vi.mock('../../lib/internal-api/work-center.client.js', () => ({
  getById: getWorkCenter,
  invalidate: vi.fn(async () => {}),
}))

import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import * as policyService from '../policy/policy.service.js'
import { bootstrapSystemReasons } from '../reason/reason.bootstrap.js'
import { Reason } from '../reason/reason.model.js'
import { UnplannedStop } from '../unplanned-stop/unplanned-stop.model.js'
import * as processor from './run-mode.processor.js'
import { RunModeProcessingState } from './run-mode-processing-state.model.js'

const userId = new Types.ObjectId().toString()

async function seedPolicyForWc(wcId: string, debounceMs: number, microStopThresholdMs = 120_000) {
  await policyService.upsertForWorkCenter(
    wcId,
    { runModeDebounceMs: debounceMs, microStopThresholdMs },
    userId,
  )
}

function sample(overrides: Partial<processor.RunModeSample>): processor.RunModeSample {
  return {
    workCenterId: overrides.workCenterId ?? new Types.ObjectId().toString(),
    runModeTagId: overrides.runModeTagId ?? new Types.ObjectId().toString(),
    value: overrides.value ?? 0,
    occurredAt: overrides.occurredAt ?? new Date('2026-06-15T10:00:00.000Z'),
  }
}

describe('run-mode.processor', () => {
  beforeEach(async () => {
    cacheStore.clear()
    getLatest.mockReset()
    getWorkCenter.mockReset()
    getLatest.mockResolvedValue(null)
    getWorkCenter.mockResolvedValue(null)
    vi.mocked(cacheGet).mockClear()
    vi.mocked(cacheSet).mockClear()
    vi.mocked(cacheDel).mockClear()
    await bootstrapSystemReasons()
  })

  describe('handleRunModeSample — cursor idempotency', () => {
    it('skips samples with occurredAt <= cursor', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 0)
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
        }),
      )
      const openCountBefore = await UnplannedStop.countDocuments({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(openCountBefore).toBe(1)

      // Replay older sample — should be skipped.
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T09:00:00.000Z'),
        }),
      )
      const openCountAfter = await UnplannedStop.countDocuments({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(openCountAfter).toBe(1)
    })
  })

  describe('handleRunModeSample — planned stop coverage', () => {
    it('skips opening when an active planned stop covers the timestamp', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 0)

      const reason = await Reason.create({
        code: `R-${new Types.ObjectId().toString()}`,
        name: 'Break',
        usages: ['planned_stop'],
        canStartManually: true,
        canBeScheduled: false,
        canConvertFromUnplanned: false,
        isSystemDefault: false,
        isActive: true,
        affectsOee: false,
        createdBy: new Types.ObjectId(userId),
      })

      await PlannedStop.create({
        workCenterId: new Types.ObjectId(wcId),
        reasonId: reason._id,
        plannedOwnerId: new Types.ObjectId(userId),
        source: 'manual',
        startMode: 'manual',
        status: 'active',
        plannedStartAt: new Date('2026-06-15T09:30:00.000Z'),
        plannedEndAt: new Date('2026-06-15T11:00:00.000Z'),
        actualStartAt: new Date('2026-06-15T09:30:00.000Z'),
        createdBy: new Types.ObjectId(userId),
      })

      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
        }),
      )
      const open = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(open).toBeNull()
    })
  })

  describe('handleRunModeSample — debounceMs === 0', () => {
    it('opens unplanned immediately', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 0)
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
        }),
      )
      const open = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(open).not.toBeNull()
      expect(open?.source).toBe('run_mode')
    })
  })

  describe('handleRunModeSample — debounceMs > 0', () => {
    it('creates a candidate instead of opening immediately', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 5000)
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
        }),
      )
      const open = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(open).toBeNull()
      expect(cacheSet).toHaveBeenCalled()
      const cacheCallArgs = vi.mocked(cacheSet).mock.calls.at(-1)!
      expect(cacheCallArgs[0]).toBe(`runmode:candidate:${wcId}:${tagId}`)
    })
  })

  describe('handleRunModeSample — running resolves candidate', () => {
    it('clears candidate and closes open unplanned when value>=1', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 0)

      // First: open an unplanned stop.
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
        }),
      )

      // Then: running sample closes it.
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 1,
          occurredAt: new Date('2026-06-15T10:01:00.000Z'),
        }),
      )
      const stillOpen = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(stillOpen).toBeNull()
    })

    it('short stop gets MICRO_STOP tag after running sample closes it', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 0, 120_000)
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
        }),
      )
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 1,
          occurredAt: new Date('2026-06-15T10:00:30.000Z'),
        }),
      )
      const closed = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
      }).lean()
      expect(closed?.reasonId).not.toBeNull()
    })
  })

  describe('confirmCandidate', () => {
    it('opens unplanned when candidate matures and latest value still < 1', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 5000)
      // Seed a candidate with firstStoppedAt = 10s in the past so matured.
      const firstStoppedAt = new Date(Date.now() - 10_000)
      const key = `runmode:candidate:${wcId}:${tagId}`
      await cacheSet(
        key,
        {
          firstStoppedAt: firstStoppedAt.toISOString(),
          runModeTagId: tagId,
          debounceMs: 5000,
        },
        60,
      )
      getLatest.mockResolvedValue({
        tagId,
        value: 0,
        occurredAt: new Date().toISOString(),
      })
      await processor.confirmCandidate({ workCenterId: wcId, runModeTagId: tagId })
      const open = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(open).not.toBeNull()
      expect(open?.startAt.getTime()).toBe(firstStoppedAt.getTime())
    })

    it('cancels candidate (no open) when latest value>=1', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 5000)
      const firstStoppedAt = new Date(Date.now() - 10_000)
      const key = `runmode:candidate:${wcId}:${tagId}`
      await cacheSet(
        key,
        {
          firstStoppedAt: firstStoppedAt.toISOString(),
          runModeTagId: tagId,
          debounceMs: 5000,
        },
        60,
      )
      getLatest.mockResolvedValue({
        tagId,
        value: 1,
        occurredAt: new Date().toISOString(),
      })
      await processor.confirmCandidate({ workCenterId: wcId, runModeTagId: tagId })
      const open = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(open).toBeNull()
    })

    it('skips when candidate has not matured yet', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 30_000)
      const firstStoppedAt = new Date(Date.now() - 1_000) // 1s ago, debounce 30s
      const key = `runmode:candidate:${wcId}:${tagId}`
      await cacheSet(
        key,
        {
          firstStoppedAt: firstStoppedAt.toISOString(),
          runModeTagId: tagId,
          debounceMs: 30_000,
        },
        60,
      )
      getLatest.mockResolvedValue({
        tagId,
        value: 0,
        occurredAt: new Date().toISOString(),
      })
      await processor.confirmCandidate({ workCenterId: wcId, runModeTagId: tagId })
      const open = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(open).toBeNull()
    })
  })

  describe('listMonitoredFromCursors', () => {
    it('returns monitored work centers from cursor documents', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await RunModeProcessingState.create({
        workCenterId: new Types.ObjectId(wcId),
        runModeTagId: new Types.ObjectId(tagId),
        lastProcessedOccurredAt: new Date('2026-06-15T10:00:00.000Z'),
        lastProcessedValue: 1,
      })
      const list = await processor.listMonitoredFromCursors()
      expect(list).toEqual([{ workCenterId: wcId, runModeTagId: tagId }])
    })
  })
})
