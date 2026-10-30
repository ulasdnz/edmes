import { CustomError } from '@mes/core'
import type { PaginationMeta } from '@mes/core/pagination'
import type { Request, Response } from 'express'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import { assertWorkCenterVisible } from '../../lib/work-center-visibility.js'
import type { IUnplannedStop } from './unplanned-stop.model.js'
import * as service from './unplanned-stop.service.js'

export const create = async (req: Request, res: Response<SuccessResponse<IUnplannedStop>>) => {
  assertWorkCenterVisible(req.user, req.body.workCenterId)
  const doc = await service.createManual(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const doc = await service.getById(req.params.id)
  assertWorkCenterVisible(req.user, doc.workCenterId.toString())
  res.json({ data: doc })
}

export const list = async (
  req: Request,
  res: Response<{ data: unknown; pagination: PaginationMeta }>,
) => {
  const query = req.query as Record<string, unknown>
  if (req.user!.id !== SYSTEM_IDENTITY) {
    const allowed = req.user!.workCenterIds ?? []
    if (query.workCenterId) {
      if (!allowed.includes(String(query.workCenterId)))
        throw new CustomError(404, 'error.not_found')
    } else {
      query.accessibleWorkCenterIds = allowed
    }
  }
  const result = await service.list(query as never)
  res.json(result)
}

export const close = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  assertWorkCenterVisible(req.user, existing.workCenterId.toString())
  const doc = await service.close(req.params.id, req.body ?? {}, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const convertToPlanned = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  assertWorkCenterVisible(req.user, existing.workCenterId.toString())
  const doc = await service.convertToPlanned(req.params.id, req.body ?? {}, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  assertWorkCenterVisible(req.user, existing.workCenterId.toString())
  const doc = await service.patch(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  assertWorkCenterVisible(req.user, existing.workCenterId.toString())
  const doc = await service.remove(req.params.id, req.user!.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
