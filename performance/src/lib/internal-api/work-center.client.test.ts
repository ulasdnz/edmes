import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/index.js', () => ({
  config: {
    INTERNAL_API_WORK_CENTER: 'http://work-center.test',
    INTERNAL_API_TOKEN: 'test-internal-api-token-at-least-32-chars',
  },
}))

vi.mock('@mes/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@mes/core')>()),
  getTraceId: () => 'trace-1',
}))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../cache.js', () => ({
  cacheWrapDedup: (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  cacheDel: vi.fn(),
}))

import { getById } from './work-center.client.js'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getById', () => {
  const workCenterId = 'aaaaaaaaaaaaaaaaaaaaaaaa'

  it('returns null when the work center does not exist', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })

    expect(await getById(workCenterId)).toBeNull()
  })

  it('reports the work center service as unreachable on a server error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

    await expect(getById(workCenterId)).rejects.toMatchObject({
      statusCode: 503,
      message: 'error.work_center_unreachable',
    })
  })

  it('reports the work center service as unreachable when it cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('network'))

    await expect(getById(workCenterId)).rejects.toMatchObject({
      statusCode: 503,
      message: 'error.work_center_unreachable',
    })
  })
})
