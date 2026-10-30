import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { hasPermission, requirePermission } from './authorize.js'

const user = (permissions: string[]) => ({ id: 'user-1', roles: [], permissions })

describe('hasPermission', () => {
  it('grants a permission the user holds', () => {
    expect(hasPermission(user(['writeProductStandards']), 'writeProductStandards')).toBe(true)
  })

  it('grants every permission to the system identity wildcard', () => {
    expect(hasPermission(user(['*']), 'backdateProductStandards')).toBe(true)
  })

  it('denies a permission the user lacks, and any permission without a user', () => {
    expect(hasPermission(user(['writeProductStandards']), 'backdateProductStandards')).toBe(false)
    expect(hasPermission(undefined, 'writeProductStandards')).toBe(false)
  })
})

describe('requirePermission', () => {
  function check(permissions: string[]) {
    const req = { user: user(permissions) } as unknown as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()
    requirePermission('writeProductStandards')(req, res as unknown as Response, next)
    return { res, next }
  }

  it('lets a user with the permission through', () => {
    expect(check(['writeProductStandards']).next).toHaveBeenCalledOnce()
  })

  it('answers 403 to a user without it', () => {
    const { res, next } = check(['readProductStandards'])

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
