import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './planned-stop.controller.js'
import {
  closePlannedStopSchema,
  createPlannedStopSchema,
  patchPlannedStopSchema,
  plannedStopIdParamSchema,
  plannedStopListSchema,
  startPlannedStopSchema,
} from './planned-stop.validators.js'

const router = Router()

router.get(
  '/planned-stops',
  requirePermission('readPlannedStops'),
  validateQuery(plannedStopListSchema),
  controller.list,
)

router.get(
  '/planned-stops/:id',
  requirePermission('readPlannedStops'),
  validateParams(plannedStopIdParamSchema),
  controller.getById,
)

router.post(
  '/planned-stops',
  requirePermission('createPlannedStops'),
  validateBody(createPlannedStopSchema),
  controller.create,
)

router.patch(
  '/planned-stops/:id',
  requirePermission('writePlannedStops'),
  validateParams(plannedStopIdParamSchema),
  validateBody(patchPlannedStopSchema),
  controller.update,
)

router.post(
  '/planned-stops/:id/start',
  requirePermission('executePlannedStops'),
  validateParams(plannedStopIdParamSchema),
  validateBody(startPlannedStopSchema),
  controller.start,
)

router.post(
  '/planned-stops/:id/close',
  requirePermission('executePlannedStops'),
  validateParams(plannedStopIdParamSchema),
  validateBody(closePlannedStopSchema),
  controller.close,
)

router.post(
  '/planned-stops/:id/cancel',
  requirePermission('executePlannedStops'),
  validateParams(plannedStopIdParamSchema),
  controller.cancel,
)

router.delete(
  '/planned-stops/:id',
  requirePermission('deletePlannedStops'),
  validateParams(plannedStopIdParamSchema),
  controller.remove,
)

export default router
