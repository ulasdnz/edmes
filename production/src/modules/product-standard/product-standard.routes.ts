import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './product-standard.controller.js'
import {
  createProductStandardSchema,
  patchProductStandardSchema,
  productStandardIdParamSchema,
  productStandardListSchema,
} from './product-standard.validators.js'

const router = Router()

router.get(
  '/product-standards',
  requirePermission('readProductStandards'),
  validateQuery(productStandardListSchema),
  controller.list,
)

router.get(
  '/product-standards/:id',
  requirePermission('readProductStandards'),
  validateParams(productStandardIdParamSchema),
  controller.getById,
)

router.post(
  '/product-standards',
  requirePermission('writeProductStandards'),
  validateBody(createProductStandardSchema),
  controller.create,
)

router.patch(
  '/product-standards/:id',
  requirePermission('writeProductStandards'),
  validateParams(productStandardIdParamSchema),
  validateBody(patchProductStandardSchema),
  controller.update,
)

router.delete(
  '/product-standards/:id',
  requirePermission('deleteProductStandards'),
  validateParams(productStandardIdParamSchema),
  controller.remove,
)

export default router
