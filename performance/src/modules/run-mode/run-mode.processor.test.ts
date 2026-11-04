import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Pending decisions and the cache live in Redis, so a real one runs. Performance builds its Redis
// clients from REDIS_URL when their module loads, so Redis starts before the imports below run.
const { redis } = await vi.hoisted(async () => {
  const { startRedisTestContainer } = await import('@mes/testing')
  const redis = await startRedisTestContainer()
  process.env.REDIS_URL = redis.url
  return { redis }
})

const { getLatest, getStateDurations } = vi.hoisted(() => ({
  getLatest: vi.fn(async () => null as null | { tagId: string; value: number; occurredAt: string }),
  getStateDurations: vi.fn(),
}))
vi.mock('../../lib/internal-api/run-mode-telemetry.client.js', () => ({
  getLatest,
  getStateDurations,
}))

const { getWorkCenter } = vi.hoisted(() => ({
  getWorkCenter: vi.fn(async () => null as unknown as { _id: string } | null),
}))
vi.mock('../../lib/internal-api/work-center.client.js', () => ({
  getById: getWorkCenter,
  invalidate: vi.fn(async () => {}),
}))

import { closeRedis, initRedis, redisClient } from '../../lib/redis.js'
import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import * as policyService from '../policy/policy.service.js'
import { bootstrapSystemReasons } from '../reason/reason.bootstrap.js'
import { Reason } from '../reason/reason.model.js'
import { UnplannedStop } from '../unplanned-stop/unplanned-stop.model.js'
import { writeDecision } from './run-mode.decisions.js'
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

const candidateKey = (wcId: string, tagId: string) => `runmode:candidate:${wcId}:${tagId}`

beforeAll(async () => {
  await initRedis()
})

afterAll(async () => {
  await closeRedis()
  await redis.stop()
})

describe('run-mode.processor', () => {
  beforeEach(async () => {
    getLatest.mockReset()
    getStateDurations.mockReset()
    getWorkCenter.mockReset()
    getLatest.mockResolvedValue(null)
    getWorkCenter.mockResolvedValue(null)
    await redisClient.flushall()
    await bootstrapSystemReasons()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
      expect(
        JSON.parse((await redisClient.get(candidateKey(wcId, tagId))) ?? 'null'),
      ).toMatchObject({ kind: 'debounce', since: '2026-06-15T10:00:00.000Z', debounceMs: 5000 })
    })

    it('stores the candidate with its first stop time for 25 hours', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 30_000)
      const set = vi.spyOn(redisClient, 'set')
      const writtenFrom = Date.now()
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
        }),
      )
      expect(set).toHaveBeenCalledTimes(1)
      const [key, , ...options] = set.mock.calls[0]
      expect(key).toBe(candidateKey(wcId, tagId))
      const candidate = JSON.parse((await redisClient.get(candidateKey(wcId, tagId))) ?? 'null')
      expect(candidate).toEqual({
        kind: 'debounce',
        since: '2026-06-15T10:00:00.000Z',
        pendingSince: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        debounceMs: 30_000,
        attempts: 0,
        nextAttemptAt: null,
      })
      // Pending from the server's time of the write, not from the stop's own time
      expect(new Date(candidate.pendingSince).getTime()).toBeGreaterThanOrEqual(writtenFrom)
      expect(new Date(candidate.pendingSince).getTime()).toBeLessThanOrEqual(Date.now())
      // Written only when no candidate is stored, in one command: the first write wins
      expect(options).toEqual(['EX', 90_000, 'NX'])
      const ttlSeconds = await redisClient.ttl(candidateKey(wcId, tagId))
      expect(ttlSeconds).toBeGreaterThan(89_900)
      expect(ttlSeconds).toBeLessThanOrEqual(90_000)
    })
  })

  describe('handleRunModeSample — samples telemetry stored that performance missed', () => {
    it('fails the sample when the replay stops at its page limit before reaching it', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 0)
      await processor.handleRunModeSample(
        sample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 1,
          occurredAt: new Date('2026-06-15T10:00:00.000Z'),
        }),
      )
      // Telemetry always has one more page, as only a fault would make it
      let page = 0
      getStateDurations.mockImplementation(async () => {
        page += 1
        const start = new Date(Date.UTC(2026, 5, 15, 10, 0, page)).toISOString()
        return {
          segments: [{ state: 1, start, end: start, durationMs: 0 }],
          hasMore: true,
          nextCursor: start,
        }
      })

      await expect(
        processor.handleRunModeSample({
          workCenterId: wcId,
          runModeTagId: tagId,
          value: 0,
          occurredAt: new Date('2026-06-15T11:00:00.000Z'),
          previousOccurredAt: new Date('2026-06-15T10:59:00.000Z'),
        }),
      ).rejects.toThrow()

      expect(getStateDurations).toHaveBeenCalledTimes(100)
      // The replayed samples keep the cursor they advanced; the sample itself is not decided
      const cursor = await RunModeProcessingState.findOne({
        workCenterId: new Types.ObjectId(wcId),
      }).lean()
      expect(cursor?.lastProcessedOccurredAt).toEqual(new Date('2026-06-15T10:01:40.000Z'))
      expect(await UnplannedStop.countDocuments({ workCenterId: new Types.ObjectId(wcId) })).toBe(0)
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
    it('opens unplanned when candidate matures and its own stopped sample is still the latest', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 5000)
      // Seed a candidate with firstStoppedAt = 10s in the past so matured.
      const firstStoppedAt = new Date(Date.now() - 10_000)
      await writeDecision(wcId, tagId, {
        kind: 'debounce',
        since: firstStoppedAt.toISOString(),
        pendingSince: new Date().toISOString(),
        debounceMs: 5000,
        attempts: 0,
        nextAttemptAt: null,
      })
      getLatest.mockResolvedValue({
        tagId,
        value: 0,
        occurredAt: firstStoppedAt.toISOString(),
      })
      await processor.confirmCandidate({ workCenterId: wcId, runModeTagId: tagId })
      const open = await UnplannedStop.findOne({
        workCenterId: new Types.ObjectId(wcId),
        endAt: null,
      })
      expect(open).not.toBeNull()
      expect(open?.startAt.getTime()).toBe(firstStoppedAt.getTime())
      expect(await redisClient.exists(candidateKey(wcId, tagId))).toBe(0)
    })

    it('keeps the candidate (no open) when telemetry knows a newer sample', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 5000)
      const firstStoppedAt = new Date(Date.now() - 10_000)
      await writeDecision(wcId, tagId, {
        kind: 'debounce',
        since: firstStoppedAt.toISOString(),
        pendingSince: new Date().toISOString(),
        debounceMs: 5000,
        attempts: 0,
        nextAttemptAt: null,
      })
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
      // The running signal decides it once performance processes it
      expect(await redisClient.exists(candidateKey(wcId, tagId))).toBe(1)
    })

    it('skips when candidate has not matured yet', async () => {
      const wcId = new Types.ObjectId().toString()
      const tagId = new Types.ObjectId().toString()
      await seedPolicyForWc(wcId, 30_000)
      const firstStoppedAt = new Date(Date.now() - 1_000) // 1s ago, debounce 30s
      await writeDecision(wcId, tagId, {
        kind: 'debounce',
        since: firstStoppedAt.toISOString(),
        pendingSince: new Date().toISOString(),
        debounceMs: 30_000,
        attempts: 0,
        nextAttemptAt: null,
      })
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
