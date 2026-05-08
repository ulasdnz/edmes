import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as historianController from './historian.controller.js'
import { multiWindowSchema, rangeQuerySchema, tagIdParamSchema } from './historian.validators.js'

const router = Router()

router.get(
  '/historian/:tagId/latest',
  validateParams(tagIdParamSchema),
  historianController.getLatest,
)

router.get(
  '/historian/:tagId/state-durations',
  validateParams(tagIdParamSchema),
  validateQuery(rangeQuerySchema),
  historianController.getStateDurations,
)

router.post(
  '/historian/:tagId/produced-summary',
  validateParams(tagIdParamSchema),
  validateBody(multiWindowSchema),
  historianController.getProducedSummary,
)

router.post(
  '/historian/:tagId/speed-summary',
  validateParams(tagIdParamSchema),
  validateBody(multiWindowSchema),
  historianController.getSpeedSummary,
)

export default router
