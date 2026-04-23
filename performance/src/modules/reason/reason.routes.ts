import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './reason.controller.js'
import {
  createReasonSchema,
  patchReasonSchema,
  reasonIdParamSchema,
  reasonListSchema,
} from './reason.validators.js'

const router = Router()

router.get(
  '/reasons',
  requirePermission('readReasons'),
  validateQuery(reasonListSchema),
  controller.list,
)

router.get(
  '/reasons/:id',
  requirePermission('readReasons'),
  validateParams(reasonIdParamSchema),
  controller.getById,
)

router.post(
  '/reasons',
  requirePermission('createReasons'),
  validateBody(createReasonSchema),
  controller.create,
)

router.patch(
  '/reasons/:id',
  requirePermission('writeReasons'),
  validateParams(reasonIdParamSchema),
  validateBody(patchReasonSchema),
  controller.update,
)

router.delete(
  '/reasons/:id',
  requirePermission('deleteReasons'),
  validateParams(reasonIdParamSchema),
  controller.remove,
)

export default router
