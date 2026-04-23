import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IReason } from './reason.model.js'
import * as service from './reason.service.js'

export const create = async (req: Request, res: Response<SuccessResponse<IReason>>) => {
  const doc = await service.create(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IReason>>,
) => {
  const doc = await service.getById(req.params.id)
  res.json({ data: doc })
}

export const list = async (req: Request, res: Response<SuccessResponse<unknown>>) => {
  const data = await service.list(req.query as never)
  res.json({ data })
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IReason>>,
) => {
  const doc = await service.update(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IReason>>,
) => {
  const doc = await service.remove(req.params.id, req.user!.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
