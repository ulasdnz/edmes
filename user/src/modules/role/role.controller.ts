import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IRole } from './role.model.js'
import * as roleService from './role.service.js'

export const createRole = async (req: Request, res: Response<SuccessResponse<IRole>>) => {
  const role = await roleService.createRole(req.body)

  res.status(201).json({
    data: role,
    message: req.t('success.create'),
  })
}

export const getRoles = async (req: Request, res: Response<SuccessResponse<IRole[]>>) => {
  const roles = await roleService.getRoles()

  res.json({
    data: roles,
  })
}

export const getRoleById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IRole>>,
) => {
  const role = await roleService.getRoleById(req.params.id)

  res.json({
    data: role,
  })
}

export const updateRole = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IRole>>,
) => {
  const role = await roleService.updateRole(req.params.id, req.body)

  res.json({
    data: role,
    message: req.t('success.update'),
  })
}

export const deleteRole = async (req: Request<{ id: string }>, res: Response<SuccessResponse>) => {
  await roleService.deleteRole(req.params.id)

  res.json({
    data: undefined,
    message: req.t('success.delete'),
  })
}
