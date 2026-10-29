import type { PaginatedResult } from '@mes/core/pagination'
import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IProductCategory } from './product-category.model.js'
import * as service from './product-category.service.js'

export const create = async (req: Request, res: Response<SuccessResponse<IProductCategory>>) => {
  const doc = await service.create(req.body)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProductCategory>>,
) => {
  const doc = await service.getById(req.params.id)
  res.json({ data: doc })
}

export const list = async (req: Request, res: Response<PaginatedResult<IProductCategory>>) => {
  const result = await service.list(req.query as never)
  res.json(result)
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProductCategory>>,
) => {
  const doc = await service.update(req.params.id, req.body)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProductCategory>>,
) => {
  const doc = await service.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
