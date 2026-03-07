import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { ISpeciality } from './speciality.model.js'
import * as specialityService from './speciality.service.js'

export const createSpeciality = async (
  req: Request,
  res: Response<SuccessResponse<ISpeciality>>,
) => {
  const speciality = await specialityService.createSpeciality(req.body)

  res.status(201).json({
    success: true,
    message: req.t('success.create'),
    data: speciality,
  })
}

export const getSpecialities = async (
  req: Request,
  res: Response<SuccessResponse<ISpeciality[]>>,
) => {
  const specialities = await specialityService.getSpecialities()

  res.json({
    success: true,
    message: req.t('success.get_all'),
    data: specialities,
  })
}

export const getSpecialityById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<ISpeciality>>,
) => {
  const speciality = await specialityService.getSpecialityById(req.params.id)

  res.json({
    success: true,
    message: req.t('success.get'),
    data: speciality,
  })
}

export const updateSpeciality = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<ISpeciality>>,
) => {
  const speciality = await specialityService.updateSpeciality(req.params.id, req.body)

  res.json({
    success: true,
    message: req.t('success.update'),
    data: speciality,
  })
}

export const deleteSpeciality = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<void>>,
) => {
  await specialityService.deleteSpeciality(req.params.id)

  res.json({
    success: true,
    message: req.t('success.delete'),
    data: undefined,
  })
}
