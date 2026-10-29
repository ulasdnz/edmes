import { CustomError, setUserId } from '@mes/core'
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { buildAuthContextCacheKey } from './cache-keys.js'
import { getAuthConfig } from './config.js'
import { AuthError } from './error.js'
import { INTERNAL_TOKEN_HEADER } from './internal-token.js'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        roles: string[]
        permissions: string[]
        workCenterIds?: string[]
      }
    }
  }
}

interface AuthContext {
  isActivated: boolean
  passwordChangedAt: string | null
  roles: string[]
  permissions: string[]
  workCenterIds: string[]
}

export type AuthUser = NonNullable<Request['user']>

const AUTH_CONTEXT_CACHE_TTL = 300 // 5 mins
const DEFAULT_USER_SERVICE_TIMEOUT_MS = 3000

// Only a missing user rejects the token. Any other failure means user-service could not answer,
// which says nothing about the token, so it surfaces as 503 instead of a forced logout.
const fetchAuthContext = async (userId: string): Promise<AuthContext> => {
  const { userServiceInternalUrl, internalApiToken, userServiceTimeoutMs } = getAuthConfig()
  const url = `${userServiceInternalUrl}/internal/v1/users/${userId}/auth-context`

  try {
    const response = await fetch(url, {
      headers: { [INTERNAL_TOKEN_HEADER]: internalApiToken },
      signal: AbortSignal.timeout(userServiceTimeoutMs ?? DEFAULT_USER_SERVICE_TIMEOUT_MS),
    })
    if (response.status === 404) throw new AuthError(401, 'auth.unauthenticated')
    if (!response.ok) throw new CustomError(503, 'auth.unavailable')
    const data = await response.json()
    return data.data
  } catch (error) {
    if (error instanceof CustomError) throw error
    throw new CustomError(503, 'auth.unavailable')
  }
}

/**
 * Verifies a JWT and loads the user's auth context (cached).
 * Shared by the HTTP middleware and non-HTTP transports such as WebSocket handshakes.
 */
export const resolveAuthUser = async (token: string): Promise<AuthUser> => {
  const { jwtSecret, cacheWrapDedup } = getAuthConfig()

  let decoded: { id: string; iat?: number }
  try {
    decoded = jwt.verify(token, jwtSecret) as { id: string; iat?: number }
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthError(401, 'auth.unauthenticated')
    }
    throw error
  }

  const ctx = await cacheWrapDedup<AuthContext>(
    buildAuthContextCacheKey(decoded.id),
    AUTH_CONTEXT_CACHE_TTL,
    () => fetchAuthContext(decoded.id),
  )

  if (!ctx || ctx.isActivated === false) {
    throw new AuthError(401, 'auth.unauthenticated')
  }

  if (ctx.passwordChangedAt && decoded.iat) {
    const passwordChangedAtSeconds = Math.floor(new Date(ctx.passwordChangedAt).getTime() / 1000)
    if (decoded.iat < passwordChangedAtSeconds) {
      throw new AuthError(401, 'auth.unauthenticated')
    }
  }

  return {
    id: decoded.id,
    roles: ctx.roles,
    permissions: ctx.permissions,
    workCenterIds: ctx.workCenterIds,
  }
}

export const authenticate: any = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthError(401, 'auth.unauthenticated')
    }

    req.user = await resolveAuthUser(authHeader.split(' ')[1])
    setUserId(req.user.id)
    next()
  } catch (error) {
    next(error)
  }
}
