import { CustomError } from '@mes/core'
import type { PaginationMeta } from '@mes/core/pagination'
import type { Request, Response } from 'express'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import { getUserWorkCenterIds } from '../../lib/internal-api/user.client.js'
import type { IUnplannedStop } from './unplanned-stop.model.js'
import * as service from './unplanned-stop.service.js'

async function assertWorkCenterVisible(userId: string, workCenterId: string): Promise<void> {
  if (userId === SYSTEM_IDENTITY) return
  const allowed = await getUserWorkCenterIds(userId)
  if (!allowed.includes(workCenterId)) throw new CustomError(404, 'error.not_found')
}

export const create = async (req: Request, res: Response<SuccessResponse<IUnplannedStop>>) => {
  await assertWorkCenterVisible(req.user!.id, req.body.workCenterId)
  const doc = await service.createManual(req.body, req.user!.id)
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
  const userId = req.user!.id
  const query = req.query as Record<string, unknown>
  if (userId !== SYSTEM_IDENTITY) {
    const allowed = await getUserWorkCenterIds(userId)
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
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.close(req.params.id, req.body ?? {}, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const convertToPlanned = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.convertToPlanned(req.params.id, req.body ?? {}, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.patch(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IUnplannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.remove(req.params.id, req.user!.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
