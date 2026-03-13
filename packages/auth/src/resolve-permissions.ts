import type { NextFunction, Request, Response } from 'express'
import { buildAuthContextCacheKey } from './cache-keys.js'
import { getAuthConfig } from './config.js'
import { AuthError } from './error.js'

const ROLES_CACHE_TTL = 300 // 5 minutes

export const resolvePermissions: any = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (!req.user || !req.user.id) {
      if (req.user) {
        req.user.roles = []
        req.user.permissions = []
      }
      return next()
    }

    const { userServiceInternalUrl, cacheWrapDedup } = getAuthConfig()

    // Single-tier resolution over internal API.
    // We cache a per-user auth context (roles + permissions) to keep
    // authorization checks fast without multi-hop lookups.
    const data = await cacheWrapDedup<{ roles: string[]; permissions: string[] }>(
      buildAuthContextCacheKey(req.user!.id),
      ROLES_CACHE_TTL,
      async () => {
        const url = `${userServiceInternalUrl}/internal/v1/users/${req.user!.id}/roles-permissions`
        const response = await fetch(url)
        if (!response.ok) {
          throw new AuthError(500, 'auth.failed_to_resolve_permissions')
        }
        const json = await response.json()
        return json.data
      },
    )

    req.user.roles = data?.roles || []
    req.user.permissions = data?.permissions || []

    next()
  } catch (error) {
    if (req.user) {
      req.user.roles = []
      req.user.permissions = []
    }
    next()
  }
}
