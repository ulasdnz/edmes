import type { NextFunction, Request, Response } from 'express'

/**
 * Ensures the authenticated user has the required permission.
 * MUST be applied AFTER authenticate and resolvePermissions.
 */
export const requirePermission = (permission: string): any => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // SYSTEM_IDENTITY bypasses all permissions via '*'
    if (req.user?.permissions?.includes('*')) {
      next()
      return
    }

    if (!req.user || !req.user.permissions?.includes(permission)) {
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
