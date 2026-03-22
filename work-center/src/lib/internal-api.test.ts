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
  it('uses a public user lookup path instead of /internal/v1 for operator validation', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    await validateOperatorExists('507f1f77bcf86cd799439021')

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/users/507f1f77bcf86cd799439021',
    )
  })

  it('uses a public dependency-check path instead of /internal/v1', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { inUse: false } }),
    })

    await isWorkCenterReferencedByUsers('507f1f77bcf86cd799439022')

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/users/check-dependencies?fieldName=workCenterIds&fieldValue=507f1f77bcf86cd799439022',
    )
  })

  it('fetches the user first and then patches /users/:id with a merged workCenterIds array', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { workCenterIds: ['507f1f77bcf86cd799439025'] } }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    await addWorkCenterToUser('507f1f77bcf86cd799439023', '507f1f77bcf86cd799439024')

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/users/507f1f77bcf86cd799439023',
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://localhost:3000/users/507f1f77bcf86cd799439023',
    )
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({
        workCenterIds: ['507f1f77bcf86cd799439025', '507f1f77bcf86cd799439024'],
      }),
    })
  })
})
