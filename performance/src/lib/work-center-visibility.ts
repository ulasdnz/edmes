import { CustomError } from '@mes/core'
import type { Request } from 'express'
import { SYSTEM_IDENTITY } from '../constants/identity.js'

// Internal calls see every work center; a user sees the ones in their auth context. Anything else
// answers 404, so a caller cannot tell a record they may not see from one that does not exist.

export function assertWorkCenterVisible(user: Request['user'], workCenterId: string): void {
  assertAllWorkCentersVisible(user, [workCenterId])
}

// For changes: a record on several work centers changes only for a user who sees all of them
export function assertAllWorkCentersVisible(user: Request['user'], workCenterIds: string[]): void {
  if (user!.id === SYSTEM_IDENTITY) return
  const visible = user!.workCenterIds ?? []
  if (workCenterIds.some(id => !visible.includes(id))) throw new CustomError(404, 'error.not_found')
}

// For reads: as in the lists, a record on several work centers shows if the user sees any of them
export function assertAnyWorkCenterVisible(user: Request['user'], workCenterIds: string[]): void {
  if (user!.id === SYSTEM_IDENTITY) return
  const visible = user!.workCenterIds ?? []
  if (!workCenterIds.some(id => visible.includes(id))) throw new CustomError(404, 'error.not_found')
}
