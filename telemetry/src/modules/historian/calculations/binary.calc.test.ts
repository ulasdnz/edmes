import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findOneMock, findMock, findToArrayMock } = vi.hoisted(() => {
  const findToArrayMock = vi.fn()
  const findMock = vi.fn(() => ({
    sort: vi.fn(() => ({
      limit: vi.fn(() => ({ toArray: findToArrayMock })),
      toArray: findToArrayMock,
    })),
  }))
  return { findOneMock: vi.fn(), findMock, findToArrayMock }
})

vi.mock('../../ingestion/historian.repository.js', () => ({
  getHistorianCollection: vi.fn(() => ({
    findOne: findOneMock,
    find: findMock,
  })),
}))

import { calculateStateDurations } from './binary.calc.js'

const rangeStart = new Date('2026-04-01T10:00:00.000Z')
const rangeEnd = new Date('2026-04-01T11:00:00.000Z')

describe('calculateStateDurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no baseline and no docs in range', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result.segments).toEqual([])
  })

  it('extends baseline state across the whole range when no docs in range', async () => {
    findOneMock.mockResolvedValue({
      occurredAt: new Date('2026-04-01T09:00:00.000Z'),
      value: 1,
    })
    findToArrayMock.mockResolvedValue([])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result.segments).toEqual([
      {
        state: 1,
        start: rangeStart,
        end: rangeEnd,
        durationMs: rangeEnd.getTime() - rangeStart.getTime(),
      },
    ])
  })

  it('uses baseline when docs in range contain transitions', async () => {
    findOneMock.mockResolvedValue({
      occurredAt: new Date('2026-04-01T09:00:00.000Z'),
      value: 1,
    })
    const t1 = new Date('2026-04-01T10:15:00.000Z')
    const t2 = new Date('2026-04-01T10:45:00.000Z')
    findToArrayMock.mockResolvedValue([
      { occurredAt: t1, value: 0 },
      { occurredAt: t2, value: 1 },
    ])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result.segments).toEqual([
      {
        state: 1,
        start: rangeStart,
        end: t1,
        durationMs: t1.getTime() - rangeStart.getTime(),
      },
      {
        state: 0,
        start: t1,
        end: t2,
        durationMs: t2.getTime() - t1.getTime(),
      },
      {
        state: 1,
        start: t2,
        end: rangeEnd,
        durationMs: rangeEnd.getTime() - t2.getTime(),
      },
    ])
  })

  it('starts from first sample occurredAt when no baseline and single sample in range', async () => {
    findOneMock.mockResolvedValue(null)
    const t1 = new Date('2026-04-01T10:20:00.000Z')
    findToArrayMock.mockResolvedValue([{ occurredAt: t1, value: 1 }])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result.segments).toEqual([
      {
        state: 1,
        start: t1,
        end: rangeEnd,
        durationMs: rangeEnd.getTime() - t1.getTime(),
      },
    ])
  })

  it('skips zero-duration segment when sample at rangeStart differs from baseline', async () => {
    findOneMock.mockResolvedValue({
      occurredAt: new Date('2026-04-01T09:00:00.000Z'),
      value: 1,
    })
    findToArrayMock.mockResolvedValue([{ occurredAt: rangeStart, value: 0 }])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result.segments).toEqual([
      {
        state: 0,
        start: rangeStart,
        end: rangeEnd,
        durationMs: rangeEnd.getTime() - rangeStart.getTime(),
      },
    ])
  })

  it('skips zero-duration final segment when last transition lands on rangeEnd', async () => {
    findOneMock.mockResolvedValue({
      occurredAt: new Date('2026-04-01T09:00:00.000Z'),
      value: 1,
    })
    findToArrayMock.mockResolvedValue([{ occurredAt: rangeEnd, value: 0 }])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result.segments).toEqual([
      {
        state: 1,
        start: rangeStart,
        end: rangeEnd,
        durationMs: rangeEnd.getTime() - rangeStart.getTime(),
      },
    ])
  })

  it('no baseline, single sample exactly at rangeEnd → empty array', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([{ occurredAt: rangeEnd, value: 1 }])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result.segments).toEqual([])
  })

  it('starts from first sample when no baseline but multiple samples with transitions', async () => {
    findOneMock.mockResolvedValue(null)
    const t1 = new Date('2026-04-01T10:10:00.000Z')
    const t2 = new Date('2026-04-01T10:30:00.000Z')
    const t3 = new Date('2026-04-01T10:50:00.000Z')
    findToArrayMock.mockResolvedValue([
      { occurredAt: t1, value: 1 },
      { occurredAt: t2, value: 0 },
      { occurredAt: t3, value: 1 },
    ])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result.segments).toEqual([
      {
        state: 1,
        start: t1,
        end: t2,
        durationMs: t2.getTime() - t1.getTime(),
      },
      {
        state: 0,
        start: t2,
        end: t3,
        durationMs: t3.getTime() - t2.getTime(),
      },
      {
        state: 1,
        start: t3,
        end: rangeEnd,
        durationMs: rangeEnd.getTime() - t3.getTime(),
      },
    ])
  })

  it('uses half-open right interval — passes $lt: rangeEnd to find filter', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([])

    await calculateStateDurations('tag-1', rangeStart, rangeEnd)

    expect(findMock).toHaveBeenCalledWith({
      occurredAt: { $gte: rangeStart, $lt: rangeEnd },
    })
  })

  it('two adjacent windows: filter-aware mock proves boundary sample is excluded from first and included in second', async () => {
    const mid = new Date('2026-04-01T10:30:00.000Z')
    const allDocs = [
      { occurredAt: new Date('2026-04-01T10:15:00.000Z'), value: 0 },
      { occurredAt: mid, value: 1 },
    ]

    const filterAware = (filter: { occurredAt: { $gte: Date; $lt?: Date; $lte?: Date } }) => {
      const { $gte, $lt, $lte } = filter.occurredAt
      const filtered = allDocs.filter(d => {
        const t = d.occurredAt.getTime()
        if (t < $gte.getTime()) return false
        if ($lt && t >= $lt.getTime()) return false
        if ($lte && t > $lte.getTime()) return false
        return true
      })
      return {
        sort: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(filtered),
        })),
      }
    }
    findMock.mockImplementationOnce(filterAware as never)
    findMock.mockImplementationOnce(filterAware as never)
    findOneMock.mockResolvedValue(null)

    const first = await calculateStateDurations('tag-1', rangeStart, mid)
    const second = await calculateStateDurations('tag-1', mid, rangeEnd)

    // Filters explicitly assert the half-open contract on both calls.
    expect(findMock.mock.calls[0][0]).toEqual({
      occurredAt: { $gte: rangeStart, $lt: mid },
    })
    expect(findMock.mock.calls[1][0]).toEqual({
      occurredAt: { $gte: mid, $lt: rangeEnd },
    })

    // First window saw only the 10:15 sample (mid sample excluded by half-open).
    expect(first.segments).toEqual([
      {
        state: 0,
        start: new Date('2026-04-01T10:15:00.000Z'),
        end: mid,
        durationMs: mid.getTime() - new Date('2026-04-01T10:15:00.000Z').getTime(),
      },
    ])
    // Second window saw the mid sample as its first in-window doc.
    expect(second.segments).toEqual([
      {
        state: 1,
        start: mid,
        end: rangeEnd,
        durationMs: rangeEnd.getTime() - mid.getTime(),
      },
    ])
  })

  describe('pagination', () => {
    it('hasMore=false (no opts.limit): closes final segment to rangeEnd, nextCursor null', async () => {
      findOneMock.mockResolvedValue({
        occurredAt: new Date('2026-04-01T09:00:00.000Z'),
        value: 1,
      })
      findToArrayMock.mockResolvedValue([])

      const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)

      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
      // Final segment closes to rangeEnd (existing behavior preserved).
      expect(result.segments).toEqual([
        {
          state: 1,
          start: rangeStart,
          end: rangeEnd,
          durationMs: rangeEnd.getTime() - rangeStart.getTime(),
        },
      ])
    })

    it('hasMore=true: drops in-progress final segment; nextCursor = last fetched sample', async () => {
      findOneMock.mockResolvedValue({
        occurredAt: new Date('2026-04-01T09:00:00.000Z'),
        value: 1,
      })
      const t1 = new Date('2026-04-01T10:10:00.000Z')
      const t2 = new Date('2026-04-01T10:20:00.000Z')
      const t3 = new Date('2026-04-01T10:30:00.000Z')
      // 3 docs available; limit=2 → fetch 3 (limit+1), hasMore=true, docs sliced to [t1, t2].
      findToArrayMock.mockResolvedValue([
        { occurredAt: t1, value: 0 },
        { occurredAt: t2, value: 1 },
        { occurredAt: t3, value: 0 },
      ])

      const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd, { limit: 2 })

      expect(result.hasMore).toBe(true)
      // nextCursor = last in-window doc's occurredAt (= t2), not the third sample.
      expect(result.nextCursor).toEqual(t2)
      // Two closed transitions: baseline 1 → 0 at t1, then 0 → 1 at t2.
      // The final in-progress segment (state=1 from t2 onward) is dropped.
      expect(result.segments).toEqual([
        {
          state: 1,
          start: rangeStart,
          end: t1,
          durationMs: t1.getTime() - rangeStart.getTime(),
        },
        {
          state: 0,
          start: t1,
          end: t2,
          durationMs: t2.getTime() - t1.getTime(),
        },
      ])
    })

    it('chunk boundary: filter-aware pagination keeps every transition across chunks', async () => {
      // True history (single chunk would yield 4 segments + tail):
      // baseline=1 (pre-window), transitions at t1=10:10 (→0), t2=10:20 (→1),
      // t3=10:30 (→0), t4=10:40 (→1), final tail closes at rangeEnd.
      const t1 = new Date('2026-04-01T10:10:00.000Z')
      const t2 = new Date('2026-04-01T10:20:00.000Z')
      const t3 = new Date('2026-04-01T10:30:00.000Z')
      const t4 = new Date('2026-04-01T10:40:00.000Z')
      const allDocs = [
        { occurredAt: t1, value: 0 },
        { occurredAt: t2, value: 1 },
        { occurredAt: t3, value: 0 },
        { occurredAt: t4, value: 1 },
      ]

      // Filter-aware mock: respects $gte/$lt and .limit(N).
      findMock.mockImplementation((filter: { occurredAt: { $gte: Date; $lt: Date } }) => {
        const { $gte, $lt } = filter.occurredAt
        const filtered = allDocs.filter(d => {
          const t = d.occurredAt.getTime()
          return t >= $gte.getTime() && t < $lt.getTime()
        })
        const sortedSorted = () => ({
          limit: (n: number) => ({
            toArray: vi.fn().mockResolvedValue(filtered.slice(0, n)),
          }),
          toArray: vi.fn().mockResolvedValue(filtered),
        })
        return { sort: vi.fn(sortedSorted) } as never
      })

      // Baseline: state at <effectiveFrom. We dispatch by query: first call uses
      // $gte=rangeStart, second uses $gte=after=t2. Pre-window value is 1 always.
      findOneMock.mockImplementation((filter: { occurredAt: { $lt: Date } }) => {
        const before = allDocs.filter(d => d.occurredAt.getTime() < filter.occurredAt.$lt.getTime())
        if (before.length === 0) {
          return Promise.resolve({ occurredAt: new Date('2026-04-01T09:00:00.000Z'), value: 1 })
        }
        return Promise.resolve(before[before.length - 1])
      })

      // Chunk 1: limit=2 → fetch 3, hasMore=true, segments contains 2 closed transitions.
      const c1 = await calculateStateDurations('tag-1', rangeStart, rangeEnd, { limit: 2 })
      expect(c1.hasMore).toBe(true)
      expect(c1.nextCursor).toEqual(t2)
      expect(c1.segments.map(s => ({ state: s.state, start: s.start, end: s.end }))).toEqual([
        { state: 1, start: rangeStart, end: t1 },
        { state: 0, start: t1, end: t2 },
      ])

      // Chunk 2: after=t2 (inclusive). baseline ($lt t2) = sample at t1 (value 0).
      // docs[0]=t2 (value 1) → first transition closes from t2 with durationMs=0 (skipped).
      // docs[1]=t3 (value 0) → segment {state:1, t2→t3}. docs[2]=t4 (value 1) → {state:0, t3→t4}.
      // Within limit, hasMore=false, final closes to rangeEnd: {state:1, t4→rangeEnd}.
      const c2 = await calculateStateDurations('tag-1', rangeStart, rangeEnd, {
        limit: 2,
        after: t2,
      })
      expect(c2.hasMore).toBe(true)
      // limit=2 → fetched 3 (t2, t3, t4) → hasMore true, docs sliced to [t2, t3].
      // baseline ($lt t2) = t1 with value 0. doc[0]=t2 (value 1) → push {state:0, t2→t2, 0ms} skipped.
      // doc[1]=t3 (value 0) → push {state:1, t2→t3}. In-progress dropped.
      expect(c2.nextCursor).toEqual(t3)
      expect(c2.segments).toEqual([
        {
          state: 1,
          start: t2,
          end: t3,
          durationMs: t3.getTime() - t2.getTime(),
        },
      ])

      // Chunk 3: after=t3. baseline ($lt t3) = t2 with value 1. fetched=[t3, t4]=2 docs,
      // limit=2 → hasMore false. doc[0]=t3 (value 0) → {state:1, t3→t3} skipped.
      // doc[1]=t4 (value 1) → {state:0, t3→t4}. Final closes to rangeEnd: {state:1, t4→rangeEnd}.
      const c3 = await calculateStateDurations('tag-1', rangeStart, rangeEnd, {
        limit: 2,
        after: t3,
      })
      expect(c3.hasMore).toBe(false)
      expect(c3.nextCursor).toBeNull()
      expect(c3.segments).toEqual([
        {
          state: 0,
          start: t3,
          end: t4,
          durationMs: t4.getTime() - t3.getTime(),
        },
        {
          state: 1,
          start: t4,
          end: rangeEnd,
          durationMs: rangeEnd.getTime() - t4.getTime(),
        },
      ])

      // Combined: every transition appears as a segment.start across the three chunks
      // (t1, t2, t3, t4) — with chunk-overlap zero-duration segments correctly skipped.
      const allStarts = [...c1.segments, ...c2.segments, ...c3.segments].map(s =>
        s.start.toISOString(),
      )
      expect(allStarts).toEqual([
        rangeStart.toISOString(),
        t1.toISOString(),
        t2.toISOString(),
        t3.toISOString(),
        t4.toISOString(),
      ])
    })

    it('after: lower bound is inclusive ($gte), passed to find filter', async () => {
      findOneMock.mockResolvedValue(null)
      findToArrayMock.mockResolvedValue([])
      const after = new Date('2026-04-01T10:30:00.000Z')

      await calculateStateDurations('tag-1', rangeStart, rangeEnd, { limit: 100, after })

      expect(findMock).toHaveBeenCalledWith({
        occurredAt: { $gte: after, $lt: rangeEnd },
      })
    })

    it('clamps after earlier than rangeStart to the requested range start', async () => {
      findOneMock.mockResolvedValue(null)
      findToArrayMock.mockResolvedValue([])
      const beforeRange = new Date('2026-04-01T09:30:00.000Z')

      await calculateStateDurations('tag-1', rangeStart, rangeEnd, {
        limit: 100,
        after: beforeRange,
      })

      expect(findOneMock).toHaveBeenCalledWith(
        { occurredAt: { $lt: rangeStart } },
        { sort: { occurredAt: -1, _id: -1 } },
      )
      expect(findMock).toHaveBeenCalledWith({
        occurredAt: { $gte: rangeStart, $lt: rangeEnd },
      })
    })

    it('defensively treats direct limit=1 as limit=2 so nextCursor advances', async () => {
      findOneMock.mockResolvedValue({
        occurredAt: new Date('2026-04-01T09:00:00.000Z'),
        value: 1,
      })
      const t1 = new Date('2026-04-01T10:10:00.000Z')
      const t2 = new Date('2026-04-01T10:20:00.000Z')
      const t3 = new Date('2026-04-01T10:30:00.000Z')
      findToArrayMock.mockResolvedValue([
        { occurredAt: t1, value: 0 },
        { occurredAt: t2, value: 1 },
        { occurredAt: t3, value: 0 },
      ])

      const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd, { limit: 1 })

      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toEqual(t2)
      expect(result.segments.map(s => s.start)).toEqual([rangeStart, t1])
    })
  })
})
