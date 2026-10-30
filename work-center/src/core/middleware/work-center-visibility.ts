import type { NextFunction, Request, Response } from 'express'
import { CustomError } from '../errors/index.js'

// Param guard for the routes under a work center: one the caller cannot see answers 404, as
// reading it does. It runs before the route's own middleware. Internal calls carry no work
// center list and see every work center.
export function requireVisibleWorkCenter(
  req: Request,
  _res: Response,
  next: NextFunction,
  workCenterId: string,
): void {
  const visible = req.user?.workCenterIds
  if (visible && !visible.includes(workCenterId)) {
    next(new CustomError(404, 'work_center.not_found'))
    return
  }
  next()
}
