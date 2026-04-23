import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './unplanned-stop.controller.js'
import {
  closeUnplannedStopSchema,
  convertToPlannedSchema,
  createUnplannedStopSchema,
  patchUnplannedStopSchema,
  unplannedStopIdParamSchema,
  unplannedStopListSchema,
} from './unplanned-stop.validators.js'

const router = Router()

router.get(
  '/unplanned-stops',
  requirePermission('readUnplannedStops'),
  validateQuery(unplannedStopListSchema),
  controller.list,
)

router.get(
  '/unplanned-stops/:id',
  requirePermission('readUnplannedStops'),
  validateParams(unplannedStopIdParamSchema),
  controller.getById,
)

router.post(
  '/unplanned-stops',
  requirePermission('createUnplannedStops'),
  validateBody(createUnplannedStopSchema),
  controller.create,
)

router.patch(
  '/unplanned-stops/:id',
  requirePermission('writeUnplannedStops'),
  validateParams(unplannedStopIdParamSchema),
  validateBody(patchUnplannedStopSchema),
  controller.update,
)

router.post(
  '/unplanned-stops/:id/close',
  requirePermission('executeUnplannedStops'),
  validateParams(unplannedStopIdParamSchema),
  validateBody(closeUnplannedStopSchema),
  controller.close,
)

router.post(
  '/unplanned-stops/:id/convert-to-planned',
  requirePermission('executeUnplannedStops'),
  validateParams(unplannedStopIdParamSchema),
  validateBody(convertToPlannedSchema),
  controller.convertToPlanned,
)

router.delete(
  '/unplanned-stops/:id',
  requirePermission('deleteUnplannedStops'),
  validateParams(unplannedStopIdParamSchema),
  controller.remove,
)

export default router
