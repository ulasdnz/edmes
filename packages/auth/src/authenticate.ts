import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { setUserId } from '@mes/core'
import { getAuthConfig } from './config.js'
import { buildAuthStatusCacheKey } from './cache-keys.js'
import { AuthError } from './error.js'

interface UserAuthStatus {
  isActivated: boolean
  passwordChangedAt: string | null
}

const AUTH_STATUS_CACHE_TTL = 300 // 5 mins

export const authenticate: any = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthError(401, 'auth.unauthenticated')
    }

    const token = authHeader.split(' ')[1]
    const { jwtSecret, userServiceInternalUrl, cacheWrapDedup } = getAuthConfig()

    const decoded = jwt.verify(token, jwtSecret) as {
      id: string
      iat?: number
    }

    // Checking status with resilient cache Dedup + HTTP fallback
    const status = await cacheWrapDedup<UserAuthStatus>(
      buildAuthStatusCacheKey(decoded.id),
      AUTH_STATUS_CACHE_TTL,
      async () => {
        const url = `${userServiceInternalUrl}/internal/v1/users/${decoded.id}/auth-status`
        const response = await fetch(url)
        if (!response.ok) {
          throw new AuthError(401, 'auth.unauthenticated')
        }
        const data = await response.json()
        return data.data
      },
    )

    if (!status || status.isActivated === false) {
      throw new AuthError(401, 'auth.unauthenticated')
    }

    if (status.passwordChangedAt && decoded.iat) {
      const passwordChangedAtSeconds = Math.floor(new Date(status.passwordChangedAt).getTime() / 1000)
      if (decoded.iat < passwordChangedAtSeconds) {
        throw new AuthError(401, 'auth.unauthenticated')
      }
    }

    req.user = {
      id: decoded.id,
      roles: [],
      permissions: [],
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
