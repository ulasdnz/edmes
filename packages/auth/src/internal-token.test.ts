import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { AuthError } from './error.js'
import { INTERNAL_TOKEN_HEADER, requireInternalToken } from './internal-token.js'

const TOKEN = 'internal-token-for-tests-0123456789abcdef'

function callWith(headers: Request['headers']) {
  const next = vi.fn()
  requireInternalToken(TOKEN)({ headers } as Request, {} as Response, next as NextFunction)
  return next
}

function expectRejected(next: ReturnType<typeof vi.fn>) {
  expect(next).toHaveBeenCalledOnce()
  const [error] = next.mock.calls[0]
  expect(error).toBeInstanceOf(AuthError)
  expect(error.statusCode).toBe(401)
  expect(error.message).toBe('auth.unauthenticated')
}

describe('requireInternalToken', () => {
  it('passes requests that carry the shared token', () => {
    const next = callWith({ [INTERNAL_TOKEN_HEADER]: TOKEN })
    expect(next).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledWith()
  })

  it('rejects requests without the token', () => {
    expectRejected(callWith({}))
  })

  it('rejects a wrong token of the same length', () => {
    expectRejected(callWith({ [INTERNAL_TOKEN_HEADER]: TOKEN.replace(/.$/, 'x') }))
  })

  it('rejects a token of a different length', () => {
    expectRejected(callWith({ [INTERNAL_TOKEN_HEADER]: `${TOKEN}-extra` }))
  })

  it('rejects repeated token headers', () => {
    expectRejected(callWith({ [INTERNAL_TOKEN_HEADER]: [TOKEN, TOKEN] as unknown as string }))
  })

  it('refuses to start without a configured token', () => {
    expect(() => requireInternalToken('')).toThrow()
  })
})
