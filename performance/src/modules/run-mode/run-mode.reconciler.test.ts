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

const { getLatest, getStateDurations } = vi.hoisted(() => ({
  getLatest: vi.fn(async () => null as null | { tagId: string; value: number; occurredAt: string }),
  getStateDurations: vi.fn(
    async () => [] as Array<{ from: string; to: string; value: number; durationMs: number }>,
  ),
}))

vi.mock('../../lib/internal-api/telemetry.client.js', () => ({
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
    getLatest.mockReset()
    getStateDurations.mockReset()
    getWorkCenter.mockReset()
    getLatest.mockResolvedValue(null)
    getStateDurations.mockResolvedValue([])
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

    getStateDurations.mockResolvedValue([
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
    ])

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

    getStateDurations.mockResolvedValue([
      {
        from: '2026-06-15T10:10:00.000Z',
        to: '2026-06-15T10:11:00.000Z',
        value: 0,
        durationMs: 60_000,
      },
    ])
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
    getStateDurations.mockResolvedValue([])

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

    getStateDurations.mockResolvedValueOnce([segment])
    await reconcileOnBoot({ now: new Date('2026-06-15T10:20:00.000Z') })

    const stopsAfterFirst = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    }).lean()
    expect(stopsAfterFirst.length).toBe(1)

    // Second boot: telemetry returns the same segment; reconciler must not
    // duplicate the stop. Whether the cursor was advanced by the first boot
    // or the processor dedups internally, the visible outcome is identical.
    getStateDurations.mockResolvedValueOnce([segment])
    await reconcileOnBoot({ now: new Date('2026-06-15T10:25:00.000Z') })

    const stopsAfterSecond = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(wcId),
    }).lean()
    expect(stopsAfterSecond.length).toBe(1)
  })
})
