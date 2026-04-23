import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listRunModeMonitors } from './run-mode-monitors.client.js'

vi.mock('../../config/index.js', () => ({
  config: { INTERNAL_API_WORK_CENTER: 'http://work-center.test' },
}))

vi.mock('@mes/core', () => ({
  getTraceId: () => 'trace-1',
}))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listRunModeMonitors', () => {
  it('calls the run-mode-monitors internal endpoint and returns parsed data', async () => {
    const data = [
      { workCenterId: 'wc-1', runModeTagId: 'tag-1' },
      { workCenterId: 'wc-2', runModeTagId: 'tag-2' },
    ]
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data }),
    })

    const result = await listRunModeMonitors()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://work-center.test/internal/v1/work-centers/run-mode-monitors')
    expect((init as RequestInit).method).toBe('GET')
    expect(result).toEqual(data)
  })

  it('returns empty array on non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const result = await listRunModeMonitors()
    expect(result).toEqual([])
  })

  it('returns empty array on fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const result = await listRunModeMonitors()
    expect(result).toEqual([])
  })
})
