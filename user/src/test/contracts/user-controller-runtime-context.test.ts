import type { Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}))

vi.mock('../../modules/user/user.service.js', () => ({
  getUser: getUserMock,
}))

import { getUser } from '../../modules/user/user.controller.js'

describe('user.controller.getUser runtime context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns runtime plant context metadata without changing the user data shape', async () => {
    const user = {
      _id: 'user-1',
      email: 'operator@example.com',
      username: 'operator',
      name: 'Operator',
      surname: 'One',
    }
    getUserMock.mockResolvedValue(user)
    const req = { user: { id: 'user-1' } } as Request
    const res = { json: vi.fn() } as unknown as Response

    await getUser(req, res)

    expect(getUserMock).toHaveBeenCalledWith('user-1')
    expect(res.json).toHaveBeenCalledWith({
      data: user,
      meta: {
        plantTimezone: 'Europe/Istanbul',
        serverTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      },
    })
  })
})
