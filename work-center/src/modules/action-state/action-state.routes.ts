import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as controller from './action-state.controller.js'
import { actionStateParamSchema, ingestActionStateSchema } from './action-state.validators.js'

// ── Public routes (mounted on both /api/v1 and /internal/v1) ────────────────

const router = Router()

// GET /work-centers/:workCenterId/action-state — latest state
router.get(
  '/work-centers/:workCenterId/action-state',
  requirePermission('readActionState'),
  validateParams(actionStateParamSchema),
  controller.getLatestActionState,
)

export default router

// ── Internal-only routes (mounted only on /internal/v1) ─────────────────────

export const actionStateInternalRoutes = Router()

// POST /work-centers/:workCenterId/action-state — ingest snapshot (OEE service)
actionStateInternalRoutes.post(
  '/work-centers/:workCenterId/action-state',
  validateParams(actionStateParamSchema),
  validateBody(ingestActionStateSchema),
  controller.ingestActionState,
)
