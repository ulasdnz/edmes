import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IOperatorCheckIn } from './operators.model.js'
import * as operatorsService from './operators.service.js'

export const checkIn = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<IOperatorCheckIn>>,
) => {
  const record = await operatorsService.checkIn(req.params.workCenterId, req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.checked_in'), data: record })
}

export const checkOut = async (
  req: Request<{ workCenterId: string; checkInId: string }>,
  res: Response<SuccessResponse<IOperatorCheckIn>>,
) => {
  const record = await operatorsService.checkOut(
    req.params.workCenterId,
    req.params.checkInId,
    req.user!.id,
  )
  res.json({ message: req.t('success.checked_out'), data: record })
}

export const getActiveCheckIns = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<IOperatorCheckIn[]>>,
) => {
  const records = await operatorsService.getActiveCheckIns(req.params.workCenterId)
  res.json({ data: records })
}
