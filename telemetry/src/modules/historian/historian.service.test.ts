import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findByIdMock, findOneMock, aggregateToArrayMock, rawToArrayMock } =
  vi.hoisted(() => ({
    findByIdMock: vi.fn(),
    findOneMock: vi.fn(),
    aggregateToArrayMock: vi.fn(),
    rawToArrayMock: vi.fn(),
  }))

vi.mock('../tag/tag.model.js', () => ({
  default: {
    findById: findByIdMock,
  },
}))

vi.mock('../ingestion/historian.repository.js', () => ({
  getHistorianCollection: vi.fn(() => ({
    findOne: findOneMock,
    find: vi.fn(() => ({
      limit: vi.fn(() => ({
        toArray: rawToArrayMock,
      })),
      sort: vi.fn(() => ({
        limit: vi.fn(() => ({
          toArray: rawToArrayMock,
        })),
      })),
    })),
    aggregate: vi.fn(() => ({
      toArray: aggregateToArrayMock,
    })),
  })),
}))

import { getSeries } from './historian.service.js'

describe('historian.service.getSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findByIdMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ behavior: 'speed' }),
      }),
    })
  })

  it('returns raw points when total sample count is within targetPoints', async () => {
    const from = new Date('2026-04-01T00:00:00.000Z')
    const to = new Date('2026-04-01T01:00:00.000Z')

    findOneMock.mockResolvedValue({ value: 10 })
    rawToArrayMock.mockResolvedValue([
      { t: new Date('2026-04-01T00:10:00.000Z'), v: 12 },
      { t: new Date('2026-04-01T00:20:00.000Z'), v: 13 },
    ])

    const result = await getSeries('tag-1', from, to, 100)

    expect(result.meta).toEqual({
      filterType: 'raw',
      targetPoints: 100,
      returnedPoints: 3,
      truncated: false,
      intervalMs: null,
      stats: {
        min: 10,
        max: 13,
        avg: 35 / 3,
        variance: 14 / 9,
        stddev: Math.sqrt(14 / 9),
        count: 3,
      },
    })
    expect(result.points).toEqual([
      { t: from, v: 10 },
      { t: new Date('2026-04-01T00:10:00.000Z'), v: 12 },
      { t: new Date('2026-04-01T00:20:00.000Z'), v: 13 },
    ])
    expect(aggregateToArrayMock).not.toHaveBeenCalled()
  })

  it('returns last-value bucketed points when total sample count exceeds targetPoints', async () => {
    const from = new Date('2026-04-01T00:00:00.000Z')
    const to = new Date('2026-04-02T00:00:00.000Z')

    findOneMock.mockResolvedValue({ value: 10 })
    rawToArrayMock.mockResolvedValue(new Array(1001).fill(null).map((_, i) => ({
      t: new Date(`2026-04-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`),
      v: i,
    })))
    aggregateToArrayMock.mockResolvedValue([
      { t: new Date('2026-04-01T06:00:00.000Z'), v: 18 },
      { t: new Date('2026-04-01T12:00:00.000Z'), v: 22 },
    ])

    const result = await getSeries('tag-1', from, to, 1000)

    expect(result.meta.filterType).toBe('last_value_bucket')
    expect(result.meta.targetPoints).toBe(1000)
    expect(result.meta.returnedPoints).toBe(3)
    expect(result.meta.truncated).toBe(true)
    expect(result.meta.intervalMs).not.toBeNull()
    expect(result.meta.stats.min).toBe(10)
    expect(result.meta.stats.max).toBe(22)
    expect(result.meta.stats.avg).toBeCloseTo(50 / 3)
    expect(result.meta.stats.variance).toBeCloseTo(224 / 9)
    expect(result.meta.stats.stddev).toBeCloseTo(Math.sqrt(224 / 9))
    expect(result.meta.stats.count).toBe(3)
    expect(result.points).toEqual([
      { t: from, v: 10 },
      { t: new Date('2026-04-01T06:00:00.000Z'), v: 18 },
      { t: new Date('2026-04-01T12:00:00.000Z'), v: 22 },
    ])
    expect(rawToArrayMock).toHaveBeenCalledTimes(1)
  })
})
