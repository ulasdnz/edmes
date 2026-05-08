import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findOneMock, findMock, findToArrayMock } = vi.hoisted(() => {
  const findToArrayMock = vi.fn()
  const findMock = vi.fn(() => ({
    sort: vi.fn(() => ({
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
    expect(result).toEqual([])
  })

  it('extends baseline state across the whole range when no docs in range', async () => {
    findOneMock.mockResolvedValue({
      occurredAt: new Date('2026-04-01T09:00:00.000Z'),
      value: 1,
    })
    findToArrayMock.mockResolvedValue([])

    const result = await calculateStateDurations('tag-1', rangeStart, rangeEnd)
    expect(result).toEqual([
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
    expect(result).toEqual([
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
    expect(result).toEqual([
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
    expect(result).toEqual([
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
    expect(result).toEqual([
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
    expect(result).toEqual([])
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
    expect(result).toEqual([
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
    expect(first).toEqual([
      {
        state: 0,
        start: new Date('2026-04-01T10:15:00.000Z'),
        end: mid,
        durationMs: mid.getTime() - new Date('2026-04-01T10:15:00.000Z').getTime(),
      },
    ])
    // Second window saw the mid sample as its first in-window doc.
    expect(second).toEqual([
      {
        state: 1,
        start: mid,
        end: rangeEnd,
        durationMs: rangeEnd.getTime() - mid.getTime(),
      },
    ])
  })
})
