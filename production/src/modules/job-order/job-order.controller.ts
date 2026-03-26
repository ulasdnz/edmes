import { CustomError } from '@mes/core'
import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import { getUserWorkCenterIds } from '../../lib/internal-api.js'
import type { PaginatedResult } from '../../utils/pagination.js'
import type { IJobOrder } from './job-order.model.js'
import * as service from './job-order.service.js'

async function resolveVisibility(req: Request): Promise<string[]> {
  const ids = await getUserWorkCenterIds(req.user!.id)
  if (!ids) throw new CustomError(503, 'error.visibility_unavailable')
  return ids
}

function assertVisible(workCenterId: string, visibleIds: string[]): void {
  if (!visibleIds.includes(workCenterId.toString())) {
    throw new CustomError(404, 'error.not_found')
  }
}

export const create = async (req: Request, res: Response<SuccessResponse<IJobOrder>>) => {
  const visibleIds = await resolveVisibility(req)
  assertVisible(req.body.workCenterId, visibleIds)
  const doc = await service.create(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const visibleIds = await resolveVisibility(req)
  const doc = await service.getById(req.params.id)
  assertVisible(doc.workCenterId.toString(), visibleIds)
  res.json({ data: doc })
}

export const list = async (req: Request, res: Response<PaginatedResult<IJobOrder>>) => {
  const visibleIds = await resolveVisibility(req)
  const result = await service.list(req.query as never, visibleIds)
  res.json(result)
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const visibleIds = await resolveVisibility(req)
  const existing = await service.getById(req.params.id)
  assertVisible(existing.workCenterId.toString(), visibleIds)
  const doc = await service.update(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const visibleIds = await resolveVisibility(req)
  const existing = await service.getById(req.params.id)
  assertVisible(existing.workCenterId.toString(), visibleIds)
  const doc = await service.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}

export const startJobOrder = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const visibleIds = await resolveVisibility(req)
  const doc = await service.start(req.params.id, req.body, req.user!.id, visibleIds)
  res.json({ message: req.t('success.update'), data: doc })
}

export const endJobOrder = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IJobOrder>>,
) => {
  const visibleIds = await resolveVisibility(req)
  const doc = await service.end(req.params.id, req.body, req.user!.id, visibleIds)
  res.json({ message: req.t('success.update'), data: doc })
}
