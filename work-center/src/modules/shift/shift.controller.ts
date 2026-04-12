import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IShift } from './shift.model.js'
import * as shiftService from './shift.service.js'

export const createShift = async (req: Request, res: Response<SuccessResponse<IShift>>) => {
  const shift = await shiftService.createShift(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.shift_created'), data: shift })
}

export const listShifts = async (_req: Request, res: Response<SuccessResponse<IShift[]>>) => {
  const shifts = await shiftService.listShifts()
  res.json({ data: shifts })
}

export const getShift = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IShift>>,
) => {
  const shift = await shiftService.getShift(req.params.id)
  res.json({ data: shift })
}

export const updateShift = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IShift>>,
) => {
  const shift = await shiftService.updateShift(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.shift_updated'), data: shift })
}

export const deleteShift = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<void>>,
) => {
  await shiftService.deleteShift(req.params.id)
  res.json({ message: req.t('success.shift_deleted'), data: undefined })
}
