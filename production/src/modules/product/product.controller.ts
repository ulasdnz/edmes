import type { PaginatedResult } from '@mes/core/pagination'
import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IProduct } from './product.model.js'
import * as productService from './product.service.js'

export const create = async (req: Request, res: Response<SuccessResponse<IProduct>>) => {
  const doc = await productService.create(req.body)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProduct>>,
) => {
  const doc = await productService.getById(req.params.id)
  res.json({ data: doc })
}

export const list = async (req: Request, res: Response<PaginatedResult<IProduct>>) => {
  const result = await productService.list(req.query as never)
  res.json(result)
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProduct>>,
) => {
  const doc = await productService.update(req.params.id, req.body)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProduct>>,
) => {
  const doc = await productService.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
