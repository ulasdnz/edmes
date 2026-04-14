import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findByIdMock, findOneMock, aggregateToArrayMock, rawToArrayMock } = vi.hoisted(() => ({
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

import { getLatest, getRollup, getSeries } from './historian.service.js'

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
    rawToArrayMock.mockResolvedValue(
      new Array(1001).fill(null).map((_, i) => ({
        t: new Date(`2026-04-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`),
        v: i,
      })),
    )
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

describe('historian.service.getRollup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findByIdMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ behavior: 'speed' }),
      }),
    })
  })

  it('fills empty buckets with the previous sample value while using aggregated bucket values', async () => {
    const from = new Date('2026-04-01T00:00:00.000Z')
    const to = new Date('2026-04-01T00:30:00.000Z')

    findOneMock.mockResolvedValue({ value: 5 })
    aggregateToArrayMock.mockResolvedValue([
      {
        bucketStart: from.getTime(),
        value: 10,
        lastValue: 12,
      },
      {
        bucketStart: new Date('2026-04-01T00:20:00.000Z').getTime(),
        value: 20,
        lastValue: 21,
      },
    ])

    const result = await getRollup('tag-1', from, to, 10 * 60_000, 'avg')

    expect(result).toEqual([
      {
        start: new Date('2026-04-01T00:00:00.000Z'),
        end: new Date('2026-04-01T00:10:00.000Z'),
        value: 10,
      },
      {
        start: new Date('2026-04-01T00:10:00.000Z'),
        end: new Date('2026-04-01T00:20:00.000Z'),
        value: 12,
      },
      {
        start: new Date('2026-04-01T00:20:00.000Z'),
        end: new Date('2026-04-01T00:30:00.000Z'),
        value: 20,
      },
    ])
    expect(rawToArrayMock).not.toHaveBeenCalled()
  })
})

describe('historian.service.getLatest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findByIdMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ behavior: 'binary' }),
      }),
    })
  })

  it('returns { tagId, value, occurredAt } for the last persisted sample', async () => {
    const occurredAt = new Date('2026-04-01T10:30:00.000Z')
    findOneMock.mockResolvedValue({ value: 1, occurredAt })

    const result = await getLatest('tag-1')

    expect(result).toEqual({ tagId: 'tag-1', value: 1, occurredAt })
    expect(findOneMock).toHaveBeenCalledWith(
      {},
      {
        sort: { occurredAt: -1, _id: -1 },
        projection: { _id: 0, value: 1, occurredAt: 1 },
      },
    )
  })

  it('returns null when tag exists but historian collection has no samples', async () => {
    findOneMock.mockResolvedValue(null)

    const result = await getLatest('tag-1')

    expect(result).toBeNull()
  })

  it('throws 404 tag.not_found when tag does not exist', async () => {
    findByIdMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    })

    await expect(getLatest('missing-tag')).rejects.toMatchObject({
      statusCode: 404,
      message: 'tag.not_found',
    })
    expect(findOneMock).not.toHaveBeenCalled()
  })
})
