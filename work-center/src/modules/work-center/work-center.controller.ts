import type { Request, Response } from 'express'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import { getUserWorkCenterIds } from '../../lib/internal-api.js'
import type { PaginatedResult } from '../../utils/pagination.js'
import type { IWorkCenter } from './work-center.model.js'
import * as workCenterService from './work-center.service.js'

/**
 * Resolve visibility filter for the current user.
 * System identity (internal calls) → no filter (sees all).
 * Regular users → restricted to their workCenterIds.
 * If user-service is unreachable → returns empty array (sees nothing, fail-closed).
 */
async function resolveVisibility(userId: string): Promise<string[] | undefined> {
  if (userId === SYSTEM_IDENTITY) return undefined
  const ids = await getUserWorkCenterIds(userId)
  return ids ?? []
}

export const createWorkCenter = async (
  req: Request,
  res: Response<SuccessResponse<IWorkCenter>>,
) => {
  const wc = await workCenterService.createWorkCenter(req.body, req.user!.id)

  res.status(201).json({
    success: true,
    message: req.t('success.create'),
    data: wc,
  })
}

export const getWorkCenter = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IWorkCenter>>,
) => {
  const visibleIds = await resolveVisibility(req.user!.id)
  const wc = await workCenterService.getWorkCenter(req.params.id, visibleIds)

  res.json({
    success: true,
    message: req.t('success.get'),
    data: wc,
  })
}

export const getWorkCenters = async (
  req: Request,
  res: Response<SuccessResponse<PaginatedResult<IWorkCenter>>>,
) => {
  const visibleIds = await resolveVisibility(req.user!.id)
  const result = await workCenterService.getWorkCenters(req.query as never, visibleIds)

  res.json({
    success: true,
    message: req.t('success.get_all'),
    data: result as never,
  })
}

export const replaceWorkCenter = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IWorkCenter>>,
) => {
  const wc = await workCenterService.replaceWorkCenter(req.params.id, req.body, req.user!.id)

  res.json({
    success: true,
    message: req.t('success.replace'),
    data: wc,
  })
}

export const updateWorkCenter = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IWorkCenter>>,
) => {
  const wc = await workCenterService.updateWorkCenter(req.params.id, req.body, req.user!.id)

  res.json({
    success: true,
    message: req.t('success.update'),
    data: wc,
  })
}

export const deleteWorkCenter = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<void>>,
) => {
  await workCenterService.hardDeleteWorkCenter(req.params.id)

  res.json({
    success: true,
    message: req.t('success.delete'),
    data: undefined,
  })
}
