import { CustomError } from '@mes/core'
import type { PaginatedResult } from '@mes/core/pagination'
import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IJobOrder } from './job-order.model.js'
import * as service from './job-order.service.js'

function assertVisible(workCenterId: string, visibleIds?: string[]): void {
  if (!visibleIds) return
  if (!visibleIds.includes(workCenterId.toString())) {
    throw new CustomError(404, 'error.not_found')
  }
}

export const create = async (req: Request, res: Response<SuccessResponse<IJobOrder>>) => {
  assertVisible(req.body.workCenterId, req.user!.workCenterIds)
  const doc = await service.create(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const doc = await service.getById(req.params.id)
  assertVisible(doc.workCenterId.toString(), req.user!.workCenterIds)
  res.json({ data: doc })
}

export const list = async (req: Request, res: Response<PaginatedResult<IJobOrder>>) => {
  const result = await service.list(req.query as never, req.user!.workCenterIds)
  res.json(result)
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const existing = await service.getById(req.params.id)
  assertVisible(existing.workCenterId.toString(), req.user!.workCenterIds)
  const doc = await service.update(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const existing = await service.getById(req.params.id)
  assertVisible(existing.workCenterId.toString(), req.user!.workCenterIds)
  const doc = await service.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}

export const startJobOrder = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const doc = await service.start(req.params.id, req.body, req.user!.id, req.user!.workCenterIds)
  res.json({ message: req.t('success.update'), data: doc })
}

export const endJobOrder = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const doc = await service.end(req.params.id, req.body, req.user!.id, req.user!.workCenterIds)
  res.json({ message: req.t('success.update'), data: doc })
}
