import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './planned-stop-template.controller.js'
import {
  closeTemplateSchema,
  createTemplateSchema,
  patchTemplateSchema,
  startTemplateSchema,
  templateIdParamSchema,
  templateListSchema,
} from './planned-stop-template.validators.js'

const router = Router()

router.get(
  '/planned-stop-templates',
  requirePermission('readPlannedStopTemplates'),
  validateQuery(templateListSchema),
  controller.list,
)

router.get(
  '/planned-stop-templates/:id',
  requirePermission('readPlannedStopTemplates'),
  validateParams(templateIdParamSchema),
  controller.getById,
)

router.post(
  '/planned-stop-templates',
  requirePermission('createPlannedStopTemplates'),
  validateBody(createTemplateSchema),
  controller.create,
)

router.patch(
  '/planned-stop-templates/:id',
  requirePermission('writePlannedStopTemplates'),
  validateParams(templateIdParamSchema),
  validateBody(patchTemplateSchema),
  controller.update,
)

router.delete(
  '/planned-stop-templates/:id',
  requirePermission('deletePlannedStopTemplates'),
  validateParams(templateIdParamSchema),
  controller.remove,
)

router.post(
  '/planned-stop-templates/:id/start',
  requirePermission('executePlannedStopTemplates'),
  validateParams(templateIdParamSchema),
  validateBody(startTemplateSchema),
  controller.startFromTemplate,
)

router.post(
  '/planned-stop-templates/:id/close',
  requirePermission('executePlannedStopTemplates'),
  validateParams(templateIdParamSchema),
  validateBody(closeTemplateSchema),
  controller.closeFromTemplate,
)

export default router
