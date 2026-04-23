import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IPerformanceRuntimePolicy } from './policy.model.js'
import * as service from './policy.service.js'

export const getFactory = async (
  _req: Request,
  res: Response<SuccessResponse<IPerformanceRuntimePolicy>>,
) => {
  const doc = await service.getFactory()
  res.json({ data: doc })
}

export const updateFactory = async (
  req: Request,
  res: Response<SuccessResponse<IPerformanceRuntimePolicy>>,
) => {
  const doc = await service.upsertFactory(req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const getForWorkCenter = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<IPerformanceRuntimePolicy>>,
) => {
  const doc = await service.getForWorkCenter(req.params.workCenterId)
  res.json({ data: doc })
}

export const updateForWorkCenter = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<IPerformanceRuntimePolicy>>,
) => {
  const doc = await service.upsertForWorkCenter(req.params.workCenterId, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const removeForWorkCenter = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<null>>,
) => {
  await service.removeForWorkCenter(req.params.workCenterId)
  res.json({ message: req.t('success.delete'), data: null })
}
