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

import { calculateSpeedAvg, calculateSpeedAvgMulti } from './speed.calc.js'

const d = (iso: string) => new Date(iso)

describe('calculateSpeedAvgMulti', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findMock.mockImplementation(() => ({
      sort: vi.fn(() => ({
        toArray: findToArrayMock,
      })),
    }))
  })

  it('returns zero totals for empty window list without hitting the DB', async () => {
    const result = await calculateSpeedAvgMulti('tag-1', [])
    expect(result).toEqual({
      windows: [],
      total: { durationMs: 0, timeWeightedAverage: 0, valueArea: 0 },
    })
    expect(findMock).not.toHaveBeenCalled()
    expect(findOneMock).not.toHaveBeenCalled()
  })

  it('calls find exactly once regardless of window count', async () => {
    findOneMock.mockResolvedValue({ occurredAt: d('2025-12-31'), value: 50 })
    findToArrayMock.mockResolvedValue([])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
      { from: d('2026-04-01T00:10:00.000Z'), to: d('2026-04-01T00:20:00.000Z') },
      { from: d('2026-04-01T00:20:00.000Z'), to: d('2026-04-01T00:30:00.000Z') },
    ]

    await calculateSpeedAvgMulti('tag-1', windows)
    expect(findMock).toHaveBeenCalledTimes(1)
  })

  it('holds baseline constant across a window with no docs', async () => {
    findOneMock.mockResolvedValue({ occurredAt: d('2025-12-31'), value: 60 })
    findToArrayMock.mockResolvedValue([])

    const windows = [{ from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') }]
    const result = await calculateSpeedAvgMulti('tag-1', windows)
    const tenMinMs = 10 * 60 * 1000
    expect(result.windows[0].durationMs).toBe(tenMinMs)
    expect(result.windows[0].valueArea).toBe(60 * tenMinMs)
    expect(result.windows[0].timeWeightedAverage).toBe(60)
    expect(result.windows[0].sampleCount).toBe(0)
  })

  it('returns zeros when neither baseline nor docs exist', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([])

    const result = await calculateSpeedAvgMulti('tag-1', [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
    ])
    expect(result.windows[0]).toEqual({
      from: d('2026-04-01T00:00:00.000Z'),
      to: d('2026-04-01T00:10:00.000Z'),
      durationMs: 0,
      valueArea: 0,
      timeWeightedAverage: 0,
      sampleCount: 0,
    })
    expect(result.total).toEqual({ durationMs: 0, timeWeightedAverage: 0, valueArea: 0 })
  })

  it('integrates value*time for a mid-window speed change (trapezoid-like)', async () => {
    findOneMock.mockResolvedValue({ occurredAt: d('2025-12-31'), value: 10 })
    findToArrayMock.mockResolvedValue([{ occurredAt: d('2026-04-01T00:05:00.000Z'), value: 20 }])

    const result = await calculateSpeedAvgMulti('tag-1', [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
    ])
    const fiveMinMs = 5 * 60 * 1000
    expect(result.windows[0].valueArea).toBe(10 * fiveMinMs + 20 * fiveMinMs)
    expect(result.windows[0].durationMs).toBe(2 * fiveMinMs)
    expect(result.windows[0].timeWeightedAverage).toBe(15)
    expect(result.windows[0].sampleCount).toBe(1)
  })

  it('total.durationMs is the sum of per-window durations (overlaps are as-provided)', async () => {
    findOneMock.mockResolvedValue({ occurredAt: d('2025-12-31'), value: 10 })
    findToArrayMock.mockResolvedValue([])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
    ]
    const result = await calculateSpeedAvgMulti('tag-1', windows)
    expect(result.total.durationMs).toBe(20 * 60 * 1000)
    expect(result.total.valueArea).toBe(10 * 20 * 60 * 1000)
    expect(result.total.timeWeightedAverage).toBe(10)
  })

  it('single-window wrapper preserves legacy { totalArea, weightedAvg, durationSec } output', async () => {
    findOneMock.mockResolvedValue({ occurredAt: d('2025-12-31'), value: 10 })
    findToArrayMock.mockResolvedValue([{ occurredAt: d('2026-04-01T00:05:00.000Z'), value: 20 }])

    const from = d('2026-04-01T00:00:00.000Z')
    const to = d('2026-04-01T00:10:00.000Z')
    const legacy = await calculateSpeedAvg('tag-1', from, to)

    expect(legacy.durationSec).toBe(600)
    expect(legacy.weightedAvg).toBe(15)
    expect(legacy.totalArea).toBe(15 * 600)
  })

  it('uses in-memory predecessor as baseline for later windows (no extra DB calls)', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([
      { occurredAt: d('2026-04-01T00:02:00.000Z'), value: 5 },
      { occurredAt: d('2026-04-01T00:12:00.000Z'), value: 25 },
    ])

    const windows = [
      { from: d('2026-04-01T00:00:00.000Z'), to: d('2026-04-01T00:10:00.000Z') },
      { from: d('2026-04-01T00:10:00.000Z'), to: d('2026-04-01T00:20:00.000Z') },
    ]
    const result = await calculateSpeedAvgMulti('tag-1', windows)

    // Window 2 baseline should come from allDocs[0] = value 5 (last doc before 00:10).
    // Points: (00:10, 5), (00:12, 25), (00:20, 25) → area = 5*2min + 25*8min
    const minMs = 60 * 1000
    expect(result.windows[1].valueArea).toBe(5 * 2 * minMs + 25 * 8 * minMs)
    expect(findMock).toHaveBeenCalledTimes(1)
  })

  it('uses closed [$gte, $lte] DB filter — deliberately not half-open', async () => {
    findOneMock.mockResolvedValue(null)
    findToArrayMock.mockResolvedValue([])
    const from = d('2026-04-01T10:00:00.000Z')
    const to = d('2026-04-01T10:10:00.000Z')

    await calculateSpeedAvgMulti('tag-1', [{ from, to }])

    // Closed boundaries are required so a sample at exactly `from` can be the integral's
    // opening value. Switching to $gt would lose that sample and zero out the value
    // change at the window's opening instant.
    expect(findMock).toHaveBeenCalledWith({
      occurredAt: { $gte: from, $lte: to },
    })
  })

  it('sample at exactly from is the opening of the area integral', async () => {
    const from = d('2026-04-01T10:00:00.000Z')
    const to = d('2026-04-01T10:10:00.000Z') // 10-minute window

    // External baseline (older sample) value = 50.
    findOneMock.mockResolvedValue({ occurredAt: d('2026-04-01T09:00:00.000Z'), value: 50 })
    // Sample at exactly `from` raises value to 100 immediately; constant until `to`.
    findToArrayMock.mockResolvedValue([
      { occurredAt: from, value: 100 },
      { occurredAt: to, value: 100 },
    ])

    const result = await calculateSpeedAvgMulti('tag-1', [{ from, to }])

    // With the boundary sample, the trapezoid is value 100 across the full window.
    // Without it, the integral would carry baseline value 50 across the window — the
    // time-weighted average would collapse to 50 instead of 100.
    const minMs = 60 * 1000
    expect(result.windows[0].timeWeightedAverage).toBe(100)
    expect(result.windows[0].valueArea).toBe(100 * 10 * minMs)
  })
})
