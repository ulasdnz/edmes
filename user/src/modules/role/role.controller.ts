import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IRole } from './role.model.js'
import * as roleService from './role.service.js'

export const createRole = async (req: Request, res: Response<SuccessResponse<IRole>>) => {
  const role = await roleService.createRole(req.body)

  res.status(201).json({
    success: true,
    message: req.t('success.create'),
    data: role,
  })
}

export const getRoles = async (req: Request, res: Response<SuccessResponse<IRole[]>>) => {
  const roles = await roleService.getRoles()

  res.json({
    success: true,
    message: req.t('success.get_all'),
    data: roles,
  })
}

export const getRoleById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IRole>>,
) => {
  const role = await roleService.getRoleById(req.params.id)

  res.json({
    success: true,
    message: req.t('success.get'),
    data: role,
  })
}

export const updateRole = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IRole>>,
) => {
  const role = await roleService.updateRole(req.params.id, req.body)

  res.json({
    success: true,
    message: req.t('success.update'),
    data: role,
  })
}

export const deleteRole = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<void>>,
) => {
  await roleService.deleteRole(req.params.id)

  res.json({
    success: true,
    message: req.t('success.delete'),
    data: undefined,
  })
}
