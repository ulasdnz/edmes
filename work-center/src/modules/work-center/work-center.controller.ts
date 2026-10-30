import type { PaginatedResult } from '@mes/core/pagination'
import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IWorkCenter } from './work-center.model.js'
import * as workCenterService from './work-center.service.js'

// A work center the caller cannot see answers 404 to changes, as it does to reads
const assertVisible = (req: Request<{ id: string }>) =>
  workCenterService.getWorkCenter(req.params.id, req.user!.workCenterIds)

export const createWorkCenter = async (
  req: Request,
  res: Response<SuccessResponse<IWorkCenter>>,
) => {
  const wc = await workCenterService.createWorkCenter(
    req.body,
    req.user!.id,
    req.user!.workCenterIds,
  )

  res.status(201).json({
    message: req.t('success.create'),
    data: wc,
  })
}

export const getWorkCenter = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IWorkCenter>>,
) => {
  const wc = await workCenterService.getWorkCenter(req.params.id, req.user!.workCenterIds)

  res.json({
    data: wc,
  })
}

export const getWorkCenters = async (
  req: Request,
  res: Response<SuccessResponse<PaginatedResult<IWorkCenter>>>,
) => {
  const result = await workCenterService.getWorkCenters(req.query as never, req.user!.workCenterIds)

  res.json({
    data: result as never,
  })
}

export const replaceWorkCenter = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IWorkCenter>>,
) => {
  await assertVisible(req)
  const wc = await workCenterService.replaceWorkCenter(
    req.params.id,
    req.body,
    req.user!.id,
    req.user!.workCenterIds,
  )

  res.json({
    message: req.t('success.replace'),
    data: wc,
  })
}

export const updateWorkCenter = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IWorkCenter>>,
) => {
  await assertVisible(req)
  const wc = await workCenterService.updateWorkCenter(
    req.params.id,
    req.body,
    req.user!.id,
    req.user!.workCenterIds,
  )

  res.json({
    message: req.t('success.update'),
    data: wc,
  })
}

export const deleteWorkCenter = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<void>>,
) => {
  await assertVisible(req)
  await workCenterService.hardDeleteWorkCenter(req.params.id)

  res.json({
    message: req.t('success.delete'),
    data: undefined,
  })
}
