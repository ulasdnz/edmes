import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './scrap-entry.controller.js'
import {
  createScrapEntrySchema,
  patchScrapEntrySchema,
  scrapEntryIdParamSchema,
  scrapEntryListSchema,
} from './scrap-entry.validators.js'

const router = Router()

router.get(
  '/scrap-entries',
  requirePermission('readProductionAdjustments'),
  validateQuery(scrapEntryListSchema),
  controller.list,
)

router.get(
  '/scrap-entries/:id',
  requirePermission('readProductionAdjustments'),
  validateParams(scrapEntryIdParamSchema),
  controller.getById,
)

router.post(
  '/scrap-entries',
  requirePermission('writeProductionAdjustments'),
  validateBody(createScrapEntrySchema),
  controller.create,
)

router.patch(
  '/scrap-entries/:id',
  requirePermission('writeProductionAdjustments'),
  validateParams(scrapEntryIdParamSchema),
  validateBody(patchScrapEntrySchema),
  controller.update,
)

router.delete(
  '/scrap-entries/:id',
  requirePermission('deleteProductionAdjustments'),
  validateParams(scrapEntryIdParamSchema),
  controller.remove,
)

export default router
