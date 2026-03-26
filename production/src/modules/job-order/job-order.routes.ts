import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './job-order.controller.js'
import {
  createJobOrderSchema,
  endJobOrderSchema,
  jobOrderIdParamSchema,
  jobOrderListSchema,
  patchJobOrderSchema,
  startJobOrderSchema,
} from './job-order.validators.js'

const router = Router()

router.get(
  '/job-orders',
  requirePermission('readJobOrders'),
  validateQuery(jobOrderListSchema),
  controller.list,
)

router.get(
  '/job-orders/:id',
  requirePermission('readJobOrders'),
  validateParams(jobOrderIdParamSchema),
  controller.getById,
)

router.post(
  '/job-orders',
  requirePermission('writeJobOrders'),
  validateBody(createJobOrderSchema),
  controller.create,
)

router.patch(
  '/job-orders/:id',
  requirePermission('writeJobOrders'),
  validateParams(jobOrderIdParamSchema),
  validateBody(patchJobOrderSchema),
  controller.update,
)

router.delete(
  '/job-orders/:id',
  requirePermission('deleteJobOrders'),
  validateParams(jobOrderIdParamSchema),
  controller.remove,
)

router.post(
  '/job-orders/:id/start',
  requirePermission('executeJobOrders'),
  validateParams(jobOrderIdParamSchema),
  validateBody(startJobOrderSchema),
  controller.startJobOrder,
)

router.post(
  '/job-orders/:id/end',
  requirePermission('executeJobOrders'),
  validateParams(jobOrderIdParamSchema),
  validateBody(endJobOrderSchema),
  controller.endJobOrder,
)

export default router
