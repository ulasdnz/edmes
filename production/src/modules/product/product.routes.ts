import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './product.controller.js'
import {
  createProductSchema,
  patchProductSchema,
  productIdParamSchema,
  productListSchema,
} from './product.validators.js'

const router = Router()

router.get(
  '/products',
  requirePermission('readCatalog'),
  validateQuery(productListSchema),
  controller.list,
)

router.get(
  '/products/:id',
  requirePermission('readCatalog'),
  validateParams(productIdParamSchema),
  controller.getById,
)

router.post(
  '/products',
  requirePermission('writeCatalog'),
  validateBody(createProductSchema),
  controller.create,
)

router.patch(
  '/products/:id',
  requirePermission('writeCatalog'),
  validateParams(productIdParamSchema),
  validateBody(patchProductSchema),
  controller.update,
)

router.delete(
  '/products/:id',
  requirePermission('deleteCatalog'),
  validateParams(productIdParamSchema),
  controller.remove,
)

export default router
