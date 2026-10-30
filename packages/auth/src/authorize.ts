import type { NextFunction, Request, Response } from 'express'

/**
 * Whether the user holds the permission. SYSTEM_IDENTITY holds every permission through '*'.
 */
export const hasPermission = (user: Request['user'], permission: string): boolean =>
  Boolean(user?.permissions?.includes('*') || user?.permissions?.includes(permission))

/**
 * Ensures the authenticated user has the required permission.
 * MUST be applied AFTER authenticate.
 */
export const requirePermission = (permission: string): any => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hasPermission(req.user, permission)) {
      res.status(403).json({
        error: {
          code: 'auth.insufficient_permissions',
          message: 'auth.insufficient_permissions',
        },
      })
      return
    }

    next()
  }
}
