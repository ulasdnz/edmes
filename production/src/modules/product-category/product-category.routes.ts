import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './product-category.controller.js'
import {
  createProductCategorySchema,
  patchProductCategorySchema,
  productCategoryIdParamSchema,
  productCategoryListSchema,
} from './product-category.validators.js'

const router = Router()

router.get(
  '/product-categories',
  requirePermission('readCatalog'),
  validateQuery(productCategoryListSchema),
  controller.list,
)

router.get(
  '/product-categories/:id',
  requirePermission('readCatalog'),
  validateParams(productCategoryIdParamSchema),
  controller.getById,
)

router.post(
  '/product-categories',
  requirePermission('writeCatalog'),
  validateBody(createProductCategorySchema),
  controller.create,
)

router.patch(
  '/product-categories/:id',
  requirePermission('writeCatalog'),
  validateParams(productCategoryIdParamSchema),
  validateBody(patchProductCategorySchema),
  controller.update,
)

router.delete(
  '/product-categories/:id',
  requirePermission('deleteCatalog'),
  validateParams(productCategoryIdParamSchema),
  controller.remove,
)

export default router
