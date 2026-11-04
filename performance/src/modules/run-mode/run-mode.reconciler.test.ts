import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as telemetry from '../../lib/internal-api/run-mode-telemetry.client.js'
import type * as workCenter from '../../lib/internal-api/work-center.client.js'

// Pending decisions and the cache live in Redis, so a real one runs. Performance builds its Redis
// clients from REDIS_URL when their module loads, so Redis starts before the imports below run.
const { redis } = await vi.hoisted(async () => {
  const { startRedisTestContainer } = await import('@mes/testing')
  const redis = await startRedisTestContainer()
  process.env.REDIS_URL = redis.url
  return { redis }
})

const emptyPage = (): telemetry.StateDurationsPage => ({
  segments: [],
  hasMore: false,
  nextCursor: null,
})

const { getLatest, getStateDurations } = vi.hoisted(() => ({
  getLatest: vi.fn<typeof telemetry.getLatest>(async () => null),
  getStateDurations: vi.fn<typeof telemetry.getStateDurations>(async () => ({
    segments: [],
    hasMore: false,
    nextCursor: null,
  })),
}))

vi.mock('../../lib/internal-api/run-mode-telemetry.client.js', () => ({
  getLatest,
  getStateDurations,
}))

const { getWorkCenter } = vi.hoisted(() => ({
  getWorkCenter: vi.fn<typeof workCenter.getById>(async () => null),
}))
vi.mock('../../lib/internal-api/work-center.client.js', () => ({
  getById: getWorkCenter,
  invalidate: vi.fn(async () => {}),
}))

import { closeRedis, initRedis, redisClient } from '../../lib/redis.js'
import { bootstrapSystemReasons } from '../reason/reason.bootstrap.js'
import { UnplannedStop } from '../unplanned-stop/unplanned-stop.model.js'
import {
  reconcileWorkCenter,
  startBootReconciliation,
  stopBootReconciliation,
} from './run-mode.reconciler.js'
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

beforeAll(async () => {
  await initRedis()
})

afterAll(async () => {
  await closeRedis()
  await redis.stop()
})

describe('run-mode.reconciler', () => {
  beforeEach(async () => {
    await redisClient.flushall()
    getLatest.mockReset()
    getStateDurations.mockReset()
    getWorkCenter.mockReset()
    getLatest.mockResolvedValue(null)
    getStateDurations.mockResolvedValue(emptyPage())
    getWorkCenter.mockResolvedValue(null)
    await bootstrapSystemReasons()
  })

  it('returns quickly with no monitored work centers', async () => {
    await expect(startBootReconciliation()).resolves.toBeUndefined()
    await stopBootReconciliation()
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
          state: 0,
          start: '2026-06-15T10:00:00.000Z',
          end: '2026-06-15T10:05:00.000Z',
          durationMs: 300_000,
        },
        // Segment after cursor — must be processed.
        {
          state: 0,
          start: '2026-06-15T10:10:00.000Z',
          end: '2026-06-15T10:15:00.000Z',
          durationMs: 300_000,
        },
      ],
      hasMore: false,
      nextCursor: null,
    })

    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )

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
          state: 0,
          start: '2026-06-15T10:10:00.000Z',
          end: '2026-06-15T10:11:00.000Z',
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

    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )

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

    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )
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

    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )

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

    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )

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
    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )
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
      state: 0,
      start: '2026-06-15T10:10:00.000Z',
      end: '2026-06-15T10:15:00.000Z',
      durationMs: 300_000,
    }

    getStateDurations.mockResolvedValueOnce({
      segments: [segment],
      hasMore: false,
      nextCursor: null,
    })
    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )

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
    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:25:00.000Z'),
    )

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
            state: 0,
            start: '2026-06-15T10:05:00.000Z',
            end: '2026-06-15T10:05:00.000Z',
            durationMs: 0,
          },
        ],
        hasMore: true,
        nextCursor: '2026-06-15T10:05:00.000Z',
      })
      .mockResolvedValueOnce({
        segments: [
          {
            state: 1,
            start: '2026-06-15T10:10:00.000Z',
            end: '2026-06-15T10:10:00.000Z',
            durationMs: 0,
          },
        ],
        hasMore: true,
        nextCursor: '2026-06-15T10:10:00.000Z',
      })
      .mockResolvedValueOnce({
        segments: [
          {
            state: 0,
            start: '2026-06-15T10:15:00.000Z',
            end: '2026-06-15T10:15:00.000Z',
            durationMs: 0,
          },
        ],
        hasMore: false,
        nextCursor: null,
      })

    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )

    expect(getStateDurations).toHaveBeenCalledTimes(3)
    // Second call should pass after = nextCursor of first chunk. A failed request logs at debug:
    // the caller that retries the reconciliation logs the failure once
    expect(getStateDurations.mock.calls[1][3]).toEqual({
      after: new Date('2026-06-15T10:05:00.000Z'),
      failureLogLevel: 'debug',
    })
    expect(getStateDurations.mock.calls[2][3]).toEqual({
      after: new Date('2026-06-15T10:10:00.000Z'),
      failureLogLevel: 'debug',
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
            state: 0,
            start: '2026-06-15T10:05:00.000Z',
            end: '2026-06-15T10:05:00.000Z',
            durationMs: 0,
          },
        ],
        hasMore: true,
        nextCursor: '2026-06-15T10:05:00.000Z',
      })
      .mockResolvedValueOnce({
        segments: [
          {
            state: 0,
            start: '2026-06-15T10:05:00.000Z',
            end: '2026-06-15T10:05:00.000Z',
            durationMs: 0,
          },
          {
            state: 1,
            start: '2026-06-15T10:10:00.000Z',
            end: '2026-06-15T10:10:00.000Z',
            durationMs: 0,
          },
        ],
        hasMore: false,
        nextCursor: null,
      })

    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T10:20:00.000Z'),
    )

    const stops = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    }).lean()
    // Exactly one stop, opened at 10:05 and closed at 10:10. No duplicate at 10:05.
    expect(stops).toHaveLength(1)
    expect(stops[0].startAt.toISOString()).toBe('2026-06-15T10:05:00.000Z')
    expect(stops[0].endAt?.toISOString()).toBe('2026-06-15T10:10:00.000Z')
  })

  it('MAX_ITER cap: goes on from the cursor the replayed samples advanced until the replay is complete', async () => {
    const wcId = new Types.ObjectId().toString()
    const tagId = new Types.ObjectId().toString()
    await seedCursor(wcId, tagId, new Date('2026-06-15T10:00:00.000Z'), 1)

    // 100 chunks that each have more after them, then the last one: one advancing sample each.
    // A replay ends at MAX_ITER (=100) chunks; the reconciliation goes on from its cursor.
    let counter = 0
    getStateDurations.mockImplementation(async () => {
      counter += 1
      const ts = new Date(Date.UTC(2026, 5, 15, 10, 0, counter)).toISOString() // 10:00:01, 10:00:02, ...
      return {
        segments: [{ state: 1, start: ts, end: ts, durationMs: 0 }],
        hasMore: counter <= 100,
        nextCursor: counter <= 100 ? ts : null,
      }
    })

    await reconcileWorkCenter(
      { workCenterId: wcId, runModeTagId: tagId },
      new Date('2026-06-15T11:00:00.000Z'),
    )

    expect(getStateDurations).toHaveBeenCalledTimes(101)
    // The second replay starts from the cursor the first one left, at its 100th sample
    expect(getStateDurations.mock.calls[100][1]).toEqual(new Date('2026-06-15T10:01:40.000Z'))
    expect(getStateDurations.mock.calls[100][3]).toEqual({ failureLogLevel: 'debug' })

    const cursor = await RunModeProcessingState.findOne({
      workCenterId: new Types.ObjectId(wcId),
      runModeTagId: new Types.ObjectId(tagId),
    }).lean()
    expect(cursor?.lastProcessedOccurredAt).toEqual(new Date('2026-06-15T10:01:41.000Z'))
  })
})
