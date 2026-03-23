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
    data: speciality,
    message: req.t('success.create'),
  })
}

export const getSpecialities = async (
  req: Request,
  res: Response<SuccessResponse<ISpeciality[]>>,
) => {
  const specialities = await specialityService.getSpecialities()

  res.json({
    data: specialities,
  })
}

export const getSpecialityById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<ISpeciality>>,
) => {
  const speciality = await specialityService.getSpecialityById(req.params.id)

  res.json({
    data: speciality,
  })
}

export const updateSpeciality = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<ISpeciality>>,
) => {
  const speciality = await specialityService.updateSpeciality(req.params.id, req.body)

  res.json({
    data: speciality,
    message: req.t('success.update'),
  })
}

export const deleteSpeciality = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse>,
) => {
  await specialityService.deleteSpeciality(req.params.id)

  res.json({
    data: undefined,
    message: req.t('success.delete'),
  })
}
