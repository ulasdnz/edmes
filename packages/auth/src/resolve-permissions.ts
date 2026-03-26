import type { NextFunction, Request, Response } from 'express'

/**
 * No-op middleware retained for backward compatibility.
 *
 * The consolidated `authenticate` middleware now fetches roles, permissions,
 * and workCenterIds in a single call. This middleware simply passes through.
 */
export const resolvePermissions: any = (_req: Request, _res: Response, next: NextFunction) => {
  next()
}
