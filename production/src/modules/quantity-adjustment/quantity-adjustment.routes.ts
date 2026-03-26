import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './quantity-adjustment.controller.js'
import {
  createQuantityAdjustmentSchema,
  patchQuantityAdjustmentSchema,
  quantityAdjustmentIdParamSchema,
  quantityAdjustmentListSchema,
} from './quantity-adjustment.validators.js'

const router = Router()

router.get(
  '/quantity-adjustments',
  requirePermission('readProductionAdjustments'),
  validateQuery(quantityAdjustmentListSchema),
  controller.list,
)

router.get(
  '/quantity-adjustments/:id',
  requirePermission('readProductionAdjustments'),
  validateParams(quantityAdjustmentIdParamSchema),
  controller.getById,
)

router.post(
  '/quantity-adjustments',
  requirePermission('writeProductionAdjustments'),
  validateBody(createQuantityAdjustmentSchema),
  controller.create,
)

router.patch(
  '/quantity-adjustments/:id',
  requirePermission('writeProductionAdjustments'),
  validateParams(quantityAdjustmentIdParamSchema),
  validateBody(patchQuantityAdjustmentSchema),
  controller.update,
)

router.delete(
  '/quantity-adjustments/:id',
  requirePermission('deleteProductionAdjustments'),
  validateParams(quantityAdjustmentIdParamSchema),
  controller.remove,
)

export default router
