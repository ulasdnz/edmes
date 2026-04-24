import { CustomError } from '@mes/core'
import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { PaginatedResult } from '../../utils/pagination.js'
import type { IScrapEntry } from './scrap-entry.model.js'
import * as service from './scrap-entry.service.js'

function assertVisible(workCenterId: string, visibleIds?: string[]): void {
  if (!visibleIds) return
  if (!visibleIds.includes(workCenterId.toString())) {
    throw new CustomError(404, 'error.not_found')
  }
}

function requireUserId(req: Request): string {
  const userId = req.user?.id
  if (!userId) throw new CustomError(401, 'auth.unauthorized')
  return userId
}

export const create = async (req: Request, res: Response<SuccessResponse<IScrapEntry>>) => {
  const doc = await service.create(req.body, requireUserId(req), req.user?.workCenterIds)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IScrapEntry>>,
) => {
  const doc = await service.getById(req.params.id)
  assertVisible(doc.workCenterId.toString(), req.user?.workCenterIds)
  res.json({ data: doc })
}

export const list = async (req: Request, res: Response<PaginatedResult<IScrapEntry>>) => {
  const result = await service.list(req.query as never, req.user?.workCenterIds)
  res.json(result)
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IScrapEntry>>,
) => {
  const doc = await service.update(
    req.params.id,
    req.body,
    requireUserId(req),
    req.user?.workCenterIds,
  )
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IScrapEntry>>,
) => {
  const doc = await service.remove(req.params.id, req.user?.workCenterIds)
  res.json({ message: req.t('success.delete'), data: doc })
}
