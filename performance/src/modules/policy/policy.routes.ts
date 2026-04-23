import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as controller from './policy.controller.js'
import { policyUpdateSchema, workCenterIdParamSchema } from './policy.validators.js'

const router = Router()

router.get(
  '/performance-policies',
  requirePermission('readPerformancePolicy'),
  controller.getFactory,
)

router.put(
  '/performance-policies',
  requirePermission('writePerformancePolicy'),
  validateBody(policyUpdateSchema),
  controller.updateFactory,
)

router.get(
  '/performance-policies/work-centers/:workCenterId',
  requirePermission('readPerformancePolicy'),
  validateParams(workCenterIdParamSchema),
  controller.getForWorkCenter,
)

router.put(
  '/performance-policies/work-centers/:workCenterId',
  requirePermission('writePerformancePolicy'),
  validateParams(workCenterIdParamSchema),
  validateBody(policyUpdateSchema),
  controller.updateForWorkCenter,
)

router.delete(
  '/performance-policies/work-centers/:workCenterId',
  requirePermission('writePerformancePolicy'),
  validateParams(workCenterIdParamSchema),
  controller.removeForWorkCenter,
)

export default router
