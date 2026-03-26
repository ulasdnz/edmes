/**
 * Protected role routes — authenticate applied at prefix level.
 */

import { requirePermission } from '@mes/auth'
import type { Request, Response } from 'express'
import { Router } from 'express'
import { PRIVILEGES } from '../../constants/privileges.js'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import * as roleController from './role.controller.js'
import { createRoleSchema, roleIdParamSchema, updateRoleSchema } from './role.validators.js'

const router = Router()

router.get('/roles', requirePermission('readRoles'), roleController.getRoles)

/**
 * GET /api/v1/roles/available-permissions — returns all available privilege definitions.
 * Used by the frontend to populate the role management UI.
 */
router.get(
  '/roles/available-permissions',
  requirePermission('readRoles'),
  (req: Request, res: Response<SuccessResponse<typeof PRIVILEGES>>) => {
    res.json({
      data: PRIVILEGES,
    })
  },
)

router.get(
  '/roles/:id',
  requirePermission('readRoles'),
  validateParams(roleIdParamSchema),
  roleController.getRoleById,
)

router.post(
  '/roles',
  requirePermission('createRoles'),
  validateBody(createRoleSchema),
  roleController.createRole,
)

router.patch(
  '/roles/:id',
  requirePermission('writeRoles'),
  validateParams(roleIdParamSchema),
  validateBody(updateRoleSchema),
  roleController.updateRole,
)

router.delete(
  '/roles/:id',
  requirePermission('deleteRoles'),
  validateParams(roleIdParamSchema),
  roleController.deleteRole,
)

export default router
