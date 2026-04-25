import { CustomError } from '@mes/core'
import type { Request, Response } from 'express'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import { getUserWorkCenterIds } from '../../lib/internal-api/user.client.js'
import type { IPlannedStopTemplate } from './planned-stop-template.model.js'
import * as service from './planned-stop-template.service.js'

async function assertAllWorkCentersVisible(userId: string, workCenterIds: string[]): Promise<void> {
  if (userId === SYSTEM_IDENTITY) return
  if (workCenterIds.length === 0) return
  const allowed = await getUserWorkCenterIds(userId)
  const forbidden = workCenterIds.find(id => !allowed.includes(id))
  if (forbidden) throw new CustomError(404, 'error.not_found')
}

async function assertWorkCenterVisible(userId: string, workCenterId: string): Promise<void> {
  if (userId === SYSTEM_IDENTITY) return
  const allowed = await getUserWorkCenterIds(userId)
  if (!allowed.includes(workCenterId)) throw new CustomError(404, 'error.not_found')
}

export const create = async (
  req: Request,
  res: Response<SuccessResponse<IPlannedStopTemplate>>,
) => {
  const workCenterIds: string[] = req.body.workCenterIds ?? []
  await assertAllWorkCentersVisible(req.user!.id, workCenterIds)
  const doc = await service.create(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStopTemplate>>,
) => {
  const doc = await service.getById(req.params.id)
  res.json({ data: doc })
}

export const list = async (
  req: Request,
  res: Response<SuccessResponse<IPlannedStopTemplate[]>>,
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
  const data = await service.list(query as never)
  res.json({ data })
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStopTemplate>>,
) => {
  const workCenterIds: string[] = req.body.workCenterIds ?? []
  await assertAllWorkCentersVisible(req.user!.id, workCenterIds)
  const doc = await service.update(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStopTemplate>>,
) => {
  const doc = await service.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}

export const startFromTemplate = async (req: Request<{ id: string }>, res: Response) => {
  await assertWorkCenterVisible(req.user!.id, req.body.workCenterId)
  const doc = await service.startFromTemplate(req.params.id, req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const closeFromTemplate = async (req: Request<{ id: string }>, res: Response) => {
  const doc = await service.closeFromTemplate(req.body.plannedStopId, req.user!.id, {
    actualEndAt: req.body.actualEndAt,
  })
  res.json({ message: req.t('success.update'), data: doc })
}
