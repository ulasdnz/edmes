import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/index.js', () => ({
  config: { INTERNAL_API_TELEMETRY: 'http://telemetry.test' },
}))

vi.mock('@mes/core', () => ({
  getTraceId: () => 'trace-1',
}))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { producedSummary, speedSummary } from './telemetry.client.js'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('producedSummary', () => {
  it('POSTs windows as ISO strings and returns parsed data', async () => {
    const payload = {
      windows: [
        {
          from: '2026-04-01T00:00:00.000Z',
          to: '2026-04-01T00:10:00.000Z',
          value: 50,
          qualityFlags: [],
        },
      ],
      total: 50,
    }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: payload }),
    })

    const result = await producedSummary('tag-1', [
      { from: new Date('2026-04-01T00:00:00.000Z'), to: new Date('2026-04-01T00:10:00.000Z') },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://telemetry.test/internal/v1/historian/tag-1/produced-summary')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      windows: [{ from: '2026-04-01T00:00:00.000Z', to: '2026-04-01T00:10:00.000Z' }],
    })
    expect(result).toEqual(payload)
  })

  it('returns null on non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const result = await producedSummary('tag-1', [
      { from: new Date('2026-04-01T00:00:00.000Z'), to: new Date('2026-04-01T00:10:00.000Z') },
    ])
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    const result = await producedSummary('tag-1', [
      { from: new Date('2026-04-01T00:00:00.000Z'), to: new Date('2026-04-01T00:10:00.000Z') },
    ])
    expect(result).toBeNull()
  })
})

describe('speedSummary', () => {
  it('POSTs windows and returns parsed data', async () => {
    const payload = {
      windows: [
        {
          from: '2026-04-01T00:00:00.000Z',
          to: '2026-04-01T00:10:00.000Z',
          durationMs: 600_000,
          timeWeightedAverage: 15,
          valueArea: 9_000_000,
          sampleCount: 1,
        },
      ],
      total: { durationMs: 600_000, timeWeightedAverage: 15, valueArea: 9_000_000 },
    }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: payload }),
    })

    const result = await speedSummary('tag-1', [
      { from: new Date('2026-04-01T00:00:00.000Z'), to: new Date('2026-04-01T00:10:00.000Z') },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://telemetry.test/internal/v1/historian/tag-1/speed-summary')
    expect((init as RequestInit).method).toBe('POST')
    expect(result).toEqual(payload)
  })
})
