import { setUserId } from '@mes/core'
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

const AUTH_CONTEXT_CACHE_TTL = 300 // 5 mins

export const authenticate: any = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthError(401, 'auth.unauthenticated')
    }

    const token = authHeader.split(' ')[1]
    const { jwtSecret, userServiceInternalUrl, internalApiToken, cacheWrapDedup } = getAuthConfig()

    const decoded = jwt.verify(token, jwtSecret) as {
      id: string
      iat?: number
    }

    const ctx = await cacheWrapDedup<AuthContext>(
      buildAuthContextCacheKey(decoded.id),
      AUTH_CONTEXT_CACHE_TTL,
      async () => {
        const url = `${userServiceInternalUrl}/internal/v1/users/${decoded.id}/auth-context`
        const response = await fetch(url, {
          headers: { [INTERNAL_TOKEN_HEADER]: internalApiToken },
        })
        if (!response.ok) {
          throw new AuthError(401, 'auth.unauthenticated')
        }
        const data = await response.json()
        return data.data
      },
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

    req.user = {
      id: decoded.id,
      roles: ctx.roles,
      permissions: ctx.permissions,
      workCenterIds: ctx.workCenterIds,
    }

    setUserId(decoded.id)
    next()
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AuthError(401, 'auth.unauthenticated'))
    } else {
      next(error)
    }
  }
}
