import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { PaginationMeta } from '../../utils/pagination.js'
import type { IUnplannedStop } from './unplanned-stop.model.js'
import * as service from './unplanned-stop.service.js'

export const create = async (req: Request, res: Response<SuccessResponse<IUnplannedStop>>) => {
  const doc = await service.createManual(req.body, req.user?.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const doc = await service.getById(req.params.id)
  res.json({ data: doc })
}

export const list = async (
  req: Request,
  res: Response<{ data: unknown; pagination: PaginationMeta }>,
) => {
  const result = await service.list(req.query as never)
  res.json(result)
}

export const close = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const doc = await service.close(req.params.id, req.body ?? {}, req.user?.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const convertToPlanned = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const doc = await service.convertToPlanned(req.params.id, req.body ?? {}, req.user?.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const doc = await service.patch(req.params.id, req.body, req.user?.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const doc = await service.remove(req.params.id, req.user?.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
