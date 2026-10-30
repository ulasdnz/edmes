import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

import {
  addWorkCenterToUser,
  isWorkCenterReferencedByUsers,
  validateOperatorExists,
} from './internal-api.js'

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('internal-api user-service contract review', () => {
  it('calls /internal/v1 path for operator validation', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    await validateOperatorExists('507f1f77bcf86cd799439021')

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/internal/v1/users/507f1f77bcf86cd799439021',
    )
  })

  it('calls /internal/v1 path for dependency check', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { inUse: false } }),
    })

    await isWorkCenterReferencedByUsers('507f1f77bcf86cd799439022')

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/internal/v1/users/check-dependencies?fieldName=workCenterIds&fieldValue=507f1f77bcf86cd799439022',
    )
  })

  // One atomic request: a fetch-merge-patch of the whole array loses concurrent additions
  it('posts the work center to /internal/v1/users/:id/work-center-ids in a single request', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    await addWorkCenterToUser('507f1f77bcf86cd799439023', '507f1f77bcf86cd799439024')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/internal/v1/users/507f1f77bcf86cd799439023/work-center-ids',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ workCenterId: '507f1f77bcf86cd799439024' }),
    })
  })
})
