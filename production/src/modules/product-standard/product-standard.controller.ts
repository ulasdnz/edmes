import { CustomError } from '@mes/core'
import type { Request, Response } from 'express'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import { getUserWorkCenterIds } from '../../lib/internal-api.js'
import type { PaginatedResult } from '../../utils/pagination.js'
import type { IProductStandard } from './product-standard.model.js'
import * as service from './product-standard.service.js'

async function resolveVisibility(req: Request): Promise<string[] | undefined> {
  if (req.user!.id === SYSTEM_IDENTITY) return undefined
  const ids = await getUserWorkCenterIds(req.user!.id)
  if (!ids) throw new CustomError(503, 'error.visibility_unavailable')
  return ids
}

function assertVisible(workCenterId: string, visibleIds?: string[]): void {
  if (!visibleIds) return
  if (!visibleIds.includes(workCenterId.toString())) {
    throw new CustomError(404, 'error.not_found')
  }
}

export const create = async (req: Request, res: Response<SuccessResponse<IProductStandard>>) => {
  const visibleIds = await resolveVisibility(req)
  assertVisible(req.body.workCenterId, visibleIds)
  const doc = await service.create(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProductStandard>>,
) => {
  const visibleIds = await resolveVisibility(req)
  const doc = await service.getById(req.params.id)
  assertVisible(doc.workCenterId.toString(), visibleIds)
  res.json({ data: doc })
}

export const list = async (req: Request, res: Response<PaginatedResult<IProductStandard>>) => {
  const visibleIds = await resolveVisibility(req)
  const result = await service.list(req.query as never, visibleIds)
  res.json(result)
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProductStandard>>,
) => {
  const visibleIds = await resolveVisibility(req)
  const existing = await service.getById(req.params.id)
  assertVisible(existing.workCenterId.toString(), visibleIds)
  const doc = await service.update(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IProductStandard>>,
) => {
  const visibleIds = await resolveVisibility(req)
  const existing = await service.getById(req.params.id)
  assertVisible(existing.workCenterId.toString(), visibleIds)
  const doc = await service.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
