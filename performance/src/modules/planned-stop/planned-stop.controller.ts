import { CustomError } from '@mes/core'
import type { Request, Response } from 'express'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import { getUserWorkCenterIds } from '../../lib/internal-api/user.client.js'
import type { PaginationMeta } from '../../utils/pagination.js'
import type { IPlannedStop } from './planned-stop.model.js'
import * as service from './planned-stop.service.js'

async function assertWorkCenterVisible(userId: string, workCenterId: string): Promise<void> {
  if (userId === SYSTEM_IDENTITY) return
  const allowed = await getUserWorkCenterIds(userId)
  if (!allowed.includes(workCenterId)) throw new CustomError(404, 'error.not_found')
}

export const create = async (req: Request, res: Response<SuccessResponse<IPlannedStop>>) => {
  await assertWorkCenterVisible(req.user!.id, req.body.workCenterId)
  const doc = await service.create(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStop>>,
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

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.update(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const start = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.start(req.params.id, req.user!.id, req.body ?? {})
  res.json({ message: req.t('success.update'), data: doc })
}

export const close = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.close(req.params.id, req.body ?? {}, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const cancel = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.cancel(req.params.id, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStop>>,
) => {
  const existing = await service.getById(req.params.id)
  await assertWorkCenterVisible(req.user!.id, existing.workCenterId.toString())
  const doc = await service.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
