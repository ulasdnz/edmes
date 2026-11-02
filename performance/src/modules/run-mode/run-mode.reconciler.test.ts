import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheGet, cacheSet, cacheDel, cacheWrap, cacheWrapDedup } = vi.hoisted(() => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  cacheDel: vi.fn(async () => {}),
  cacheWrap: vi.fn(async (_k: string, _t: number, loader: () => Promise<unknown>) => loader()),
  cacheWrapDedup: vi.fn(async (_k: string, _t: number, loader: () => Promise<unknown>) => loader()),
}))

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

type Segment = { from: string; to: string; value: number; durationMs: number }
type Page = { segments: Segment[]; hasMore: boolean; nextCursor: string | null }
const emptyPage = (): Page => ({ segments: [], hasMore: false, nextCursor: null })

const { getLatest, getStateDurations } = vi.hoisted(() => ({
  getLatest: vi.fn(async () => null as null | { tagId: string; value: number; occurredAt: string }),
  getStateDurations: vi.fn(
    async () =>
      ({ segments: [], hasMore: false, nextCursor: null }) as {
        segments: Array<{ from: string; to: string; value: number; durationMs: number }>
        hasMore: boolean
        nextCursor: string | null
      },
  ),
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

// Pending decisions go through the raw Redis client; this stands in for it where no Redis runs.
// The contract tests run the same code against a real Redis.
const { redisStore, redisClient } = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    redisStore: store,
    redisClient: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string, ..._options: unknown[]) => {
        store.set(key, value)
        return 'OK'
      },
      del: async (key: string) => (store.delete(key) ? 1 : 0),
    },
  }
})
vi.mock('../../lib/redis.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/redis.js')>()),
  redisClient,
}))

import { bootstrapSystemReasons } from '../reason/reason.bootstrap.js'
import { UnplannedStop } from '../unplanned-stop/unplanned-stop.model.js'
import { reconcileOnBoot } from './run-mode.reconciler.js'
import { RunModeProcessingState } from './run-mode-processing-state.model.js'

async function seedCursor(
  workCenterId: string,
  runModeTagId: string,
  lastProcessedOccurredAt: Date,
  lastProcessedValue = 1,
) {
  await RunModeProcessingState.create({
    workCenterId: new Types.ObjectId(workCenterId),
    runModeTagId: new Types.ObjectId(runModeTagId),
    lastProcessedOccurredAt,
    lastProcessedValue,
  })
}

describe('run-mode.reconciler', () => {
  beforeEach(async () => {
    redisStore.clear()
    getLatest.mockReset()
    getStateDurations.mockReset()
    getWorkCenter.mockReset()
    getLatest.mockResolvedValue(null)
    getStateDurations.mockResolvedValue(emptyPage())
    getWorkCenter.mockResolvedValue(null)
    await bootstrapSystemReasons()
  })

  it('returns quickly with no monitored work centers', async () => {
    await expect(reconcileOnBoot({ now: new Date() })).resolves.toBeUndefined()
    expect(getLatest).not.toHaveBeenCalled()
    expect(getStateDurations).not.toHaveBeenCalled()
  })

  it('when cursor exists: replays only segments with occurredAt > cursor', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    const cursorAt = new Date('2026-06-15T10:00:00.000Z')
    await seedCursor(wcId, tagId, cursorAt, 1)

    getStateDurations.mockResolvedValue({
      segments: [
        // Segment at/before cursor — must be ignored.
        {
          from: '2026-06-15T10:00:00.000Z',
          to: '2026-06-15T10:05:00.000Z',
          value: 0,
          durationMs: 300_000,
        },
        // Segment after cursor — must be processed.
        {
          from: '2026-06-15T10:10:00.000Z',
          to: '2026-06-15T10:15:00.000Z',
          value: 0,
          durationMs: 300_000,
        },
      ],
      hasMore: false,
      nextCursor: null,
    })

    await reconcileOnBoot({ now: new Date('2026-06-15T10:20:00.000Z') })

    const openStops = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    }).lean()
    expect(openStops.length).toBe(1)
    expect(openStops[0].startAt.toISOString()).toBe('2026-06-15T10:10:00.000Z')
  })

  it('when cursor exists and segments are populated: does NOT fall back to latest', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    await seedCursor(wcId, tagId, new Date('2026-06-15T10:00:00.000Z'), 1)

    getStateDurations.mockResolvedValue({
      segments: [
        {
          from: '2026-06-15T10:10:00.000Z',
          to: '2026-06-15T10:11:00.000Z',
          value: 0,
          durationMs: 60_000,
        },
      ],
      hasMore: false,
      nextCursor: null,
    })
    getLatest.mockResolvedValue({
      tagId,
      value: 0,
      occurredAt: '2026-06-15T10:30:00.000Z',
    })

    await reconcileOnBoot({ now: new Date('2026-06-15T10:20:00.000Z') })

    // Only one open should exist: from the state-durations segment, not from latest.
    const stops = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    }).lean()
    expect(stops.length).toBe(1)
    expect(stops[0].startAt.toISOString()).toBe('2026-06-15T10:10:00.000Z')
    expect(getLatest).not.toHaveBeenCalled()
  })

  it('when cursor exists but segments are empty: no open, no latest fallback', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    await seedCursor(wcId, tagId, new Date('2026-06-15T10:00:00.000Z'), 1)
    getStateDurations.mockResolvedValue(emptyPage())

    await reconcileOnBoot({ now: new Date('2026-06-15T10:20:00.000Z') })
    const openCount = await UnplannedStop.countDocuments({
      workCenterId: new Types.ObjectId(wcId),
    })
    expect(openCount).toBe(0)
    expect(getLatest).not.toHaveBeenCalled()
  })

  it('when no cursor: uses latest value < 1 to open unplanned', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()

    getLatest.mockResolvedValue({
      tagId,
      value: 0,
      occurredAt: '2026-06-15T10:00:00.000Z',
    })

    await reconcileOnBoot({
      now: new Date('2026-06-15T10:20:00.000Z'),
      monitored: [{ workCenterId: wcId, runModeTagId: tagId }],
    })

    const open = await UnplannedStop.findOne({
      workCenterId: new Types.ObjectId(wcId),
      endAt: null,
    })
    expect(open).not.toBeNull()
    expect(open?.startAt.toISOString()).toBe('2026-06-15T10:00:00.000Z')
  })

  it('when no cursor and latest >= 1: initializes cursor only, no unplanned opened', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()

    getLatest.mockResolvedValue({
      tagId,
      value: 1,
      occurredAt: '2026-06-15T10:00:00.000Z',
    })

    await reconcileOnBoot({
      now: new Date('2026-06-15T10:20:00.000Z'),
      monitored: [{ workCenterId: wcId, runModeTagId: tagId }],
    })

    const open = await UnplannedStop.findOne({
      workCenterId: new Types.ObjectId(wcId),
      endAt: null,
    })
    expect(open).toBeNull()

    const cursor = await RunModeProcessingState.findOne({
      workCenterId: new Types.ObjectId(wcId),
      runModeTagId: new Types.ObjectId(tagId),
    }).lean()
    expect(cursor).not.toBeNull()
    expect(cursor?.lastProcessedOccurredAt.toISOString()).toBe('2026-06-15T10:00:00.000Z')
  })

  it('when no cursor and no latest: no-op', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    getLatest.mockResolvedValue(null)
    await reconcileOnBoot({
      now: new Date('2026-06-15T10:20:00.000Z'),
      monitored: [{ workCenterId: wcId, runModeTagId: tagId }],
    })
    const openCount = await UnplannedStop.countDocuments({
      workCenterId: new Types.ObjectId(wcId),
    })
    expect(openCount).toBe(0)
    const cursor = await RunModeProcessingState.findOne({
      workCenterId: new Types.ObjectId(wcId),
      runModeTagId: new Types.ObjectId(tagId),
    }).lean()
    expect(cursor).toBeNull()
  })

  it('idempotent across boots: re-running with the same segment data does not double-create stops', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    const cursorAt = new Date('2026-06-15T10:00:00.000Z')
    await seedCursor(wcId, tagId, cursorAt, 1)

    const segment = {
      from: '2026-06-15T10:10:00.000Z',
      to: '2026-06-15T10:15:00.000Z',
      value: 0,
      durationMs: 300_000,
    }

    getStateDurations.mockResolvedValueOnce({
      segments: [segment],
      hasMore: false,
      nextCursor: null,
    })
    await reconcileOnBoot({ now: new Date('2026-06-15T10:20:00.000Z') })

    const stopsAfterFirst = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    }).lean()
    expect(stopsAfterFirst.length).toBe(1)

    // Second boot: telemetry returns the same segment; reconciler must not
    // duplicate the stop. Whether the cursor was advanced by the first boot
    // or the processor dedups internally, the visible outcome is identical.
    getStateDurations.mockResolvedValueOnce({
      segments: [segment],
      hasMore: false,
      nextCursor: null,
    })
    await reconcileOnBoot({ now: new Date('2026-06-15T10:25:00.000Z') })

    const stopsAfterSecond = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    }).lean()
    expect(stopsAfterSecond.length).toBe(1)
  })

  it('paginated state-durations: iterates chunks until hasMore=false and processes all transitions', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    await seedCursor(wcId, tagId, new Date('2026-06-15T10:00:00.000Z'), 1)

    // Three chunks: stop at 10:05, run at 10:10, stop again at 10:15.
    getStateDurations
      .mockResolvedValueOnce({
        segments: [
          {
            from: '2026-06-15T10:05:00.000Z',
            to: '2026-06-15T10:05:00.000Z',
            value: 0,
            durationMs: 0,
          },
        ],
        hasMore: true,
        nextCursor: '2026-06-15T10:05:00.000Z',
      })
      .mockResolvedValueOnce({
        segments: [
          {
            from: '2026-06-15T10:10:00.000Z',
            to: '2026-06-15T10:10:00.000Z',
            value: 1,
            durationMs: 0,
          },
        ],
        hasMore: true,
        nextCursor: '2026-06-15T10:10:00.000Z',
      })
      .mockResolvedValueOnce({
        segments: [
          {
            from: '2026-06-15T10:15:00.000Z',
            to: '2026-06-15T10:15:00.000Z',
            value: 0,
            durationMs: 0,
          },
        ],
        hasMore: false,
        nextCursor: null,
      })

    await reconcileOnBoot({ now: new Date('2026-06-15T10:20:00.000Z') })

    expect(getStateDurations).toHaveBeenCalledTimes(3)
    // Second call should pass after = nextCursor of first chunk.
    expect(getStateDurations.mock.calls[1][3]).toEqual({
      after: new Date('2026-06-15T10:05:00.000Z'),
    })
    expect(getStateDurations.mock.calls[2][3]).toEqual({
      after: new Date('2026-06-15T10:10:00.000Z'),
    })

    // Outcome: first stop opened at 10:05, closed at 10:10; second stop opened at 10:15.
    const stops = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    })
      .sort({ startAt: 1 })
      .lean()
    expect(stops).toHaveLength(2)
    expect(stops[0].startAt.toISOString()).toBe('2026-06-15T10:05:00.000Z')
    expect(stops[0].endAt?.toISOString()).toBe('2026-06-15T10:10:00.000Z')
    expect(stops[1].startAt.toISOString()).toBe('2026-06-15T10:15:00.000Z')
    expect(stops[1].endAt).toBeNull()
  })

  it('chunk overlap: sample at exactly the previous chunk’s nextCursor is not double-processed', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    await seedCursor(wcId, tagId, new Date('2026-06-15T10:00:00.000Z'), 1)

    // Chunk 1: open stop at 10:05; nextCursor = 10:05.
    // Chunk 2: returns the boundary sample 10:05 (after-inclusive) PLUS a new
    // transition at 10:10 closing the stop. The boundary sample must be skipped
    // by handleRunModeSample's DB cursor guard, so no duplicate stop is created.
    getStateDurations
      .mockResolvedValueOnce({
        segments: [
          {
            from: '2026-06-15T10:05:00.000Z',
            to: '2026-06-15T10:05:00.000Z',
            value: 0,
            durationMs: 0,
          },
        ],
        hasMore: true,
        nextCursor: '2026-06-15T10:05:00.000Z',
      })
      .mockResolvedValueOnce({
        segments: [
          {
            from: '2026-06-15T10:05:00.000Z',
            to: '2026-06-15T10:05:00.000Z',
            value: 0,
            durationMs: 0,
          },
          {
            from: '2026-06-15T10:10:00.000Z',
            to: '2026-06-15T10:10:00.000Z',
            value: 1,
            durationMs: 0,
          },
        ],
        hasMore: false,
        nextCursor: null,
      })

    await reconcileOnBoot({ now: new Date('2026-06-15T10:20:00.000Z') })

    const stops = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    }).lean()
    // Exactly one stop, opened at 10:05 and closed at 10:10. No duplicate at 10:05.
    expect(stops).toHaveLength(1)
    expect(stops[0].startAt.toISOString()).toBe('2026-06-15T10:05:00.000Z')
    expect(stops[0].endAt?.toISOString()).toBe('2026-06-15T10:10:00.000Z')
  })

  it('MAX_ITER cap: bails after 100 chunks; cursor stays at last successfully processed sample', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    await seedCursor(wcId, tagId, new Date('2026-06-15T10:00:00.000Z'), 1)

    // Mock that always returns hasMore=true with a unique advancing nextCursor.
    // The reconciler must bail at MAX_ITER (=100) instead of looping forever.
    let counter = 0
    getStateDurations.mockImplementation(async () => {
      counter += 1
      const ts = new Date(Date.UTC(2026, 5, 15, 10, 0, counter)).toISOString() // 10:00:01, 10:00:02, ...
      return {
        segments: [{ from: ts, to: ts, value: 1, durationMs: 0 }],
        hasMore: true,
        nextCursor: ts,
      }
    })

    await reconcileOnBoot({ now: new Date('2026-06-15T11:00:00.000Z') })

    // Reconciler must have stopped exactly at MAX_ITER iterations, not infinite.
    expect(getStateDurations).toHaveBeenCalledTimes(100)

    // Cursor must have advanced to the last sample successfully processed by
    // handleRunModeSample (so a subsequent boot resumes from there). All segments
    // in this scenario carry value=1 (running) which closes any open stop and
    // updates the cursor; we just assert cursor is past the seed.
    const cursor = await RunModeProcessingState.findOne({
      workCenterId: new Types.ObjectId(wcId),
      runModeTagId: new Types.ObjectId(tagId),
    }).lean()
    expect(cursor).not.toBeNull()
    expect(cursor!.lastProcessedOccurredAt.getTime()).toBeGreaterThan(
      new Date('2026-06-15T10:00:00.000Z').getTime(),
    )
  })
})
