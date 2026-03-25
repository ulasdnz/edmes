import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { PaginatedResult } from '../../utils/pagination.js'
import type { IUom } from './uom.model.js'
import * as uomService from './uom.service.js'

export const create = async (req: Request, res: Response<SuccessResponse<IUom>>) => {
  const doc = await uomService.create(req.body)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUom>>,
) => {
  const doc = await uomService.getById(req.params.id)
  res.json({ data: doc })
}

export const list = async (req: Request, res: Response<PaginatedResult<IUom>>) => {
  const result = await uomService.list(req.query as never)
  res.json(result)
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUom>>,
) => {
  const doc = await uomService.update(req.params.id, req.body)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUom>>,
) => {
  const doc = await uomService.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
