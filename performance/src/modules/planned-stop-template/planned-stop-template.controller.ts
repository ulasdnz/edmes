import { CustomError } from '@mes/core'
import type { Request, Response } from 'express'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IPlannedStopTemplate } from './planned-stop-template.model.js'
import * as service from './planned-stop-template.service.js'

function assertAllWorkCentersVisible(user: Request['user'], workCenterIds: string[]): void {
  if (user!.id === SYSTEM_IDENTITY) return
  const allowed = user!.workCenterIds ?? []
  const forbidden = workCenterIds.find(id => !allowed.includes(id))
  if (forbidden) throw new CustomError(404, 'error.not_found')
}

function assertWorkCenterVisible(user: Request['user'], workCenterId: string): void {
  assertAllWorkCentersVisible(user, [workCenterId])
}

export const create = async (
  req: Request,
  res: Response<SuccessResponse<IPlannedStopTemplate>>,
) => {
  const workCenterIds: string[] = req.body.workCenterIds ?? []
  assertAllWorkCentersVisible(req.user, workCenterIds)
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
  const data = await service.list(query as never)
  res.json({ data })
}

export const update = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStopTemplate>>,
) => {
  const workCenterIds: string[] = req.body.workCenterIds ?? []
  assertAllWorkCentersVisible(req.user, workCenterIds)
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
  assertWorkCenterVisible(req.user, req.body.workCenterId)
  const doc = await service.startFromTemplate(req.params.id, req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const closeFromTemplate = async (req: Request<{ id: string }>, res: Response) => {
  const doc = await service.closeFromTemplate(req.body.plannedStopId, req.user!.id, {
    actualEndAt: req.body.actualEndAt,
  })
  res.json({ message: req.t('success.update'), data: doc })
}
