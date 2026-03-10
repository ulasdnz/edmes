import type { RequestHandler } from 'express'
import { vi } from 'vitest'

export interface MockUser {
  _id: string
  email: string
  roles: string[]
  permissions: string[]
}

const defaultMockUser: MockUser = {
  _id: '000000000000000000000001',
  email: 'test@test.com',
  roles: ['admin'],
  permissions: ['*'],
}

export function createAuthMocks(user: Partial<MockUser> = {}) {
  const mockUser = { ...defaultMockUser, ...user }

  const authenticate: RequestHandler = (_req, _res, next) => {
    ;(_req as any).user = mockUser
    next()
  }

  const resolvePermissions: RequestHandler = (_req, _res, next) => {
    ;(_req as any).permissions = mockUser.permissions
    next()
  }

  const requirePermission =
    (_permission: string): RequestHandler =>
    (_req, _res, next) => {
      next()
    }

  return {
    authenticate: vi.fn(authenticate),
    resolvePermissions: vi.fn(resolvePermissions),
    requirePermission: vi.fn(requirePermission),
    configureAuth: vi.fn(),
    getAuthConfig: vi.fn(() => ({})),
    mockUser,
  }
}
