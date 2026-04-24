import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findOneMock, findMock, findToArrayMock } = vi.hoisted(() => ({
  findOneMock: vi.fn(),
  findMock: vi.fn(),
  findToArrayMock: vi.fn(),
}))

vi.mock('../../ingestion/historian.repository.js', () => ({
  getHistorianCollection: vi.fn(() => ({
    findOne: findOneMock,
    find: findMock,
  })),
}))

findMock.mockImplementation(() => ({
  sort: vi.fn(() => ({
    toArray: findToArrayMock,
  })),
}))

import { calculateProduced, calculateProducedMulti } from './counter.calc.js'

const d = (iso: string) => new Date(iso)

const baseDoc = {
  prevValue: null as number | null,
  prevTs: null as Date | null,
  prev2Value: null as number | null,
  reset: false,
}

describe('calculateProducedMulti', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findMock.mockImplementation(() => ({
      sort: vi.fn(() => ({
        toArray: findToArrayMock,
      })),
    }))
  })

  it('returns { windows: [], total: 0 } for no windows and does not hit the DB', async () => {
    const result = await calculateProducedMulti('tag-1', [])
    expect(result).toEqual({ windows: [], total: 0 })
    expect(findMock).not.toHaveBeenCalled()
    expect(findOneMock).not.toHaveBeenCalled()
  })

  it('calls collection.find exactly once regardless of window count', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 100, prevValue: 50 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:15:00.000Z'), value: 150, prevValue: 100 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:25:00.000Z'), value: 200, prevValue: 150 },
    ])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
      { from: d('2026-04-01T00:10:00.000Z'), to: d('2026-04-01T00:20:00.000Z') },
      { from: d('2026-04-01T00:20:00.000Z'), to: d('2026-04-01T00:30:00.000Z') },
    ]

    await calculateProducedMulti('tag-1', windows)
    expect(findMock).toHaveBeenCalledTimes(1)
    expect(findMock.mock.calls[0][0]).toEqual({
      occurredAt: { $gte: windows[0].from, $lte: windows[2].to },
    })
  })

  it('sums values across non-overlapping windows (total = arithmetic sum)', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 100, prevValue: 50 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:15:00.000Z'), value: 150, prevValue: 100 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:25:00.000Z'), value: 200, prevValue: 150 },
    ])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
      { from: d('2026-04-01T00:10:00.000Z'), to: d('2026-04-01T00:20:00.000Z') },
      { from: d('2026-04-01T00:20:00.000Z'), to: d('2026-04-01T00:30:00.000Z') },
    ]

    const result = await calculateProducedMulti('tag-1', windows)
    expect(result.windows).toHaveLength(3)
    expect(result.windows[0].value).toBe(50)
    expect(result.windows[1].value).toBe(50)
    expect(result.windows[2].value).toBe(50)
    expect(result.total).toBe(150)
  })

  it('double-counts overlapping windows as-provided (caller responsibility)', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 100, prevValue: 50 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:15:00.000Z'), value: 200, prevValue: 100 },
    ])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:20:00.000Z') },
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:20:00.000Z') },
    ]

    const result = await calculateProducedMulti('tag-1', windows)
    expect(result.windows[0].value).toBe(150)
    expect(result.windows[1].value).toBe(150)
    expect(result.total).toBe(300)
  })

  it('marks samples_missing when no docs in a window and value=0', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:30:00.000Z'), value: 200, prevValue: 150 },
    ])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
      { from: d('2026-04-01T00:25:00.000Z'), to: d('2026-04-01T00:35:00.000Z') },
    ]

    const result = await calculateProducedMulti('tag-1', windows)
    expect(result.windows[0]).toEqual({
      from: windows[0].from,
      to: windows[0].to,
      value: 0,
      qualityFlags: ['samples_missing'],
    })
    expect(result.windows[1].value).toBe(50)
    expect(result.windows[1].qualityFlags).toEqual([])
  })

  it('marks missing_baseline when no baseline and first doc has null prevValue', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 100, prevValue: null },
    ])

    const result = await calculateProducedMulti('tag-1', [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
    ])
    expect(result.windows[0].value).toBe(100)
    expect(result.windows[0].qualityFlags).toContain('missing_baseline')
  })

  it('marks counter_reset_observed when window contains a reset doc', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 100, prevValue: 50 },
      {
        ...baseDoc,
        occurredAt: d('2026-04-01T00:15:00.000Z'),
        value: 10,
        prevValue: 0,
        prev2Value: 100,
        prevTs: d('2026-04-01T00:05:00.000Z'),
        reset: true,
      },
      { ...baseDoc, occurredAt: d('2026-04-01T00:25:00.000Z'), value: 30, prevValue: 20 },
    ])

    const windows = [{ from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:30:00.000Z') }]
    const result = await calculateProducedMulti('tag-1', windows)
    expect(result.windows[0].qualityFlags).toContain('counter_reset_observed')
  })

  it('uses overall baseline for first window when startIdx=0 and per-window baseline for later windows', async () => {
    findOneMock.mockResolvedValue({ ...baseDoc, occurredAt: d('2025-12-31'), value: 40 })
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 100, prevValue: null },
      { ...baseDoc, occurredAt: d('2026-04-01T00:15:00.000Z'), value: 200, prevValue: null },
    ])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
      { from: d('2026-04-01T00:10:00.000Z'), to: d('2026-04-01T00:20:00.000Z') },
    ]

    const result = await calculateProducedMulti('tag-1', windows)
    expect(result.windows[0].value).toBe(60) // 100 - overall baseline 40
    expect(result.windows[0].qualityFlags).toEqual([])
    expect(result.windows[1].value).toBe(100) // 200 - allDocs[0].value 100
    expect(result.windows[1].qualityFlags).toEqual([])
  })

  it('does not double-count a sample at a shared window boundary (half-open (from, to])', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 50, prevValue: 0 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:10:00.000Z'), value: 100, prevValue: 50 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:20:00.000Z'), value: 200, prevValue: 100 },
    ])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
      { from: d('2026-04-01T00:10:00.000Z'), to: d('2026-04-01T00:20:00.000Z') },
    ]

    const result = await calculateProducedMulti('tag-1', windows)
    expect(result.windows[0].value).toBe(100)
    expect(result.windows[1].value).toBe(100)
    expect(result.total).toBe(200)
  })

  it('single-window wrapper matches multi-window output byte-for-byte', async () => {
    findOneMock.mockResolvedValue({ ...baseDoc, occurredAt: d('2025-12-31'), value: 40 })
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 100, prevValue: 60 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:25:00.000Z'), value: 200, prevValue: 180 },
    ])

    const from = d('2026-04-01T00:00:00.000Z')
    const to = d('2026-04-01T00:30:00.000Z')
    const singleValue = await calculateProduced('tag-1', from, to)

    findOneMock.mockResolvedValue({ ...baseDoc, occurredAt: d('2025-12-31'), value: 40 })
    findToArrayMock.mockResolvedValue([
      { ...baseDoc, occurredAt: d('2026-04-01T00:05:00.000Z'), value: 100, prevValue: 60 },
      { ...baseDoc, occurredAt: d('2026-04-01T00:25:00.000Z'), value: 200, prevValue: 180 },
    ])

    const multi = await calculateProducedMulti('tag-1', [{ from, to }])
    expect(multi.windows[0].value).toBe(singleValue)
    expect(multi.total).toBe(singleValue)
  })
})
