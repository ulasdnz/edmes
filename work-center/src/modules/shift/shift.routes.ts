import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as controller from './shift.controller.js'
import { createShiftSchema, patchShiftSchema, shiftIdParamSchema } from './shift.validators.js'

const router = Router()

router.get('/shifts', requirePermission('readSchedules'), controller.listShifts)

router.get(
  '/shifts/:id',
  requirePermission('readSchedules'),
  validateParams(shiftIdParamSchema),
  controller.getShift,
)

router.post(
  '/shifts',
  requirePermission('writeSchedules'),
  validateBody(createShiftSchema),
  controller.createShift,
)

router.patch(
  '/shifts/:id',
  requirePermission('writeSchedules'),
  validateParams(shiftIdParamSchema),
  validateBody(patchShiftSchema),
  controller.updateShift,
)

router.delete(
  '/shifts/:id',
  requirePermission('writeSchedules'),
  validateParams(shiftIdParamSchema),
  controller.deleteShift,
)

export default router
