import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as historianController from './historian.controller.js'
import { multiWindowSchema, tagIdParamSchema } from './historian.validators.js'

const router = Router()

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
