import { CustomError } from '@mes/core'
import type { Request, Response } from 'express'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import {
  assertAllWorkCentersVisible,
  assertAnyWorkCenterVisible,
} from '../../lib/work-center-visibility.js'
import type { IPlannedStopSchedule } from './planned-stop-schedule.model.js'
import * as service from './planned-stop-schedule.service.js'

export const create = async (
  req: Request,
  res: Response<SuccessResponse<IPlannedStopSchedule>>,
) => {
  const workCenterIds: string[] = req.body.workCenterIds ?? []
  assertAllWorkCentersVisible(req.user, workCenterIds)
  const doc = await service.create(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}

export const getById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStopSchedule>>,
) => {
  const doc = await service.getById(req.params.id)
  assertAnyWorkCenterVisible(req.user, doc.workCenterIds.map(String))
  res.json({ data: doc })
}

export const list = async (
  req: Request,
  res: Response<SuccessResponse<IPlannedStopSchedule[]>>,
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
  res: Response<SuccessResponse<IPlannedStopSchedule>>,
) => {
  const existing = await service.getById(req.params.id)
  assertAllWorkCentersVisible(req.user, existing.workCenterIds.map(String))
  const workCenterIds: string[] = req.body.workCenterIds ?? []
  assertAllWorkCentersVisible(req.user, workCenterIds)
  const doc = await service.update(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}

export const remove = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IPlannedStopSchedule>>,
) => {
  const existing = await service.getById(req.params.id)
  assertAllWorkCentersVisible(req.user, existing.workCenterIds.map(String))
  const doc = await service.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
