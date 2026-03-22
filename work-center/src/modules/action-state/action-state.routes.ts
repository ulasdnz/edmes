import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as controller from './action-state.controller.js'
import { actionStateParamSchema, ingestActionStateSchema } from './action-state.validators.js'

const router = Router()

// POST /work-centers/:workCenterId/action-state — ingest snapshot
router.post(
  '/work-centers/:workCenterId/action-state',
  requirePermission('writeWorkCenters'),
  validateParams(actionStateParamSchema),
  validateBody(ingestActionStateSchema),
  controller.ingestActionState,
)

// GET /work-centers/:workCenterId/action-state — latest state
router.get(
  '/work-centers/:workCenterId/action-state',
  requirePermission('readActionState'),
  validateParams(actionStateParamSchema),
  controller.getLatestActionState,
)

export default router
