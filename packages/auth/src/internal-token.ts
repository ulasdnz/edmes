import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { AuthError } from './error.js'

export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

/**
 * Guards /internal routes with a shared service-to-service token, so only our own
 * services can use them, not every container that can reach the service on the network.
 * MUST be applied before the middleware that grants SYSTEM_IDENTITY permissions.
 */
export const requireInternalToken = (expectedToken: string) => {
  if (!expectedToken) {
    throw new Error('[@mes/auth] requireInternalToken requires a non-empty token.')
  }
  const expected = Buffer.from(expectedToken)

  return (req: Request, _res: Response, next: NextFunction): void => {
    const provided = req.headers[INTERNAL_TOKEN_HEADER]
    const actual = typeof provided === 'string' ? Buffer.from(provided) : null

    if (!actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      next(new AuthError(401, 'auth.unauthenticated'))
      return
    }

    next()
  }
}
