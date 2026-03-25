import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './production-plan.controller.js'
import {
  createProductionPlanSchema,
  patchProductionPlanSchema,
  productionPlanIdParamSchema,
  productionPlanListSchema,
} from './production-plan.validators.js'

const router = Router()

router.get(
  '/production-plans',
  requirePermission('readProductionPlans'),
  validateQuery(productionPlanListSchema),
  controller.list,
)

router.get(
  '/production-plans/:id',
  requirePermission('readProductionPlans'),
  validateParams(productionPlanIdParamSchema),
  controller.getById,
)

router.post(
  '/production-plans',
  requirePermission('writeProductionPlans'),
  validateBody(createProductionPlanSchema),
  controller.create,
)

router.patch(
  '/production-plans/:id',
  requirePermission('writeProductionPlans'),
  validateParams(productionPlanIdParamSchema),
  validateBody(patchProductionPlanSchema),
  controller.update,
)

router.delete(
  '/production-plans/:id',
  requirePermission('deleteProductionPlans'),
  validateParams(productionPlanIdParamSchema),
  controller.remove,
)

export default router
