import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import { requireVisibleWorkCenter } from '../../core/middleware/work-center-visibility.js'
import * as controller from './operators.controller.js'
import {
  checkInIdParamSchema,
  checkInSchema,
  operatorWorkCenterIdParamSchema,
} from './operators.validators.js'

const router = Router()
router.param('workCenterId', requireVisibleWorkCenter)

// POST /work-centers/:workCenterId/operators — check in
router.post(
  '/work-centers/:workCenterId/operators',
  requirePermission('writeOperators'),
  validateParams(operatorWorkCenterIdParamSchema),
  validateBody(checkInSchema),
  controller.checkIn,
)

// GET /work-centers/:workCenterId/operators — list active check-ins
router.get(
  '/work-centers/:workCenterId/operators',
  requirePermission('readOperators'),
  validateParams(operatorWorkCenterIdParamSchema),
  controller.getActiveCheckIns,
)

// PATCH /work-centers/:workCenterId/operators/:checkInId — check out
router.patch(
  '/work-centers/:workCenterId/operators/:checkInId',
  requirePermission('writeOperators'),
  validateParams(checkInIdParamSchema),
  controller.checkOut,
)

export default router
