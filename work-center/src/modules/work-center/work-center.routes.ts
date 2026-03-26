/**
 * Protected work center routes — authenticate applied at prefix level.
 */

import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as workCenterController from './work-center.controller.js'
import {
  createWorkCenterSchema,
  patchWorkCenterSchema,
  workCenterIdParamSchema,
  workCenterListSchema,
} from './work-center.validators.js'

const router = Router()

router.post(
  '/work-centers',
  requirePermission('writeWorkCenters'),
  validateBody(createWorkCenterSchema),
  workCenterController.createWorkCenter,
)

router.get(
  '/work-centers',
  requirePermission('readWorkCenters'),
  validateQuery(workCenterListSchema),
  workCenterController.getWorkCenters,
)

router.get(
  '/work-centers/:id',
  requirePermission('readWorkCenters'),
  validateParams(workCenterIdParamSchema),
  workCenterController.getWorkCenter,
)

router.put(
  '/work-centers/:id',
  requirePermission('writeWorkCenters'),
  validateParams(workCenterIdParamSchema),
  workCenterController.replaceWorkCenter,
)

router.patch(
  '/work-centers/:id',
  requirePermission('writeWorkCenters'),
  validateParams(workCenterIdParamSchema),
  validateBody(patchWorkCenterSchema),
  workCenterController.updateWorkCenter,
)

router.delete(
  '/work-centers/:id',
  requirePermission('deleteWorkCenters'),
  validateParams(workCenterIdParamSchema),
  workCenterController.deleteWorkCenter,
)

export default router
