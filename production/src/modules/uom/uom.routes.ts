import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './uom.controller.js'
import {
  createUomSchema,
  patchUomSchema,
  uomIdParamSchema,
  uomListSchema,
} from './uom.validators.js'

const router = Router()

router.get('/uoms', requirePermission('readCatalog'), validateQuery(uomListSchema), controller.list)

router.get(
  '/uoms/:id',
  requirePermission('readCatalog'),
  validateParams(uomIdParamSchema),
  controller.getById,
)

router.post(
  '/uoms',
  requirePermission('writeCatalog'),
  validateBody(createUomSchema),
  controller.create,
)

router.patch(
  '/uoms/:id',
  requirePermission('writeCatalog'),
  validateParams(uomIdParamSchema),
  validateBody(patchUomSchema),
  controller.update,
)

router.delete(
  '/uoms/:id',
  requirePermission('deleteCatalog'),
  validateParams(uomIdParamSchema),
  controller.remove,
)

export default router
