import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as edgeDeviceController from './edge-device.controller.js'
import {
  createEdgeDeviceSchema,
  edgeDeviceIdParamSchema,
  updateEdgeDeviceSchema,
} from './edge-device.validators.js'

const router = Router()

router.get(
  '/edge-devices',
  requirePermission('readEdgeDevices'),
  edgeDeviceController.getEdgeDevices,
)

router.get(
  '/edge-devices/:id',
  requirePermission('readEdgeDevices'),
  validateParams(edgeDeviceIdParamSchema),
  edgeDeviceController.getEdgeDeviceById,
)

router.post(
  '/edge-devices',
  requirePermission('createEdgeDevices'),
  validateBody(createEdgeDeviceSchema),
  edgeDeviceController.createEdgeDevice,
)

router.patch(
  '/edge-devices/:id',
  requirePermission('writeEdgeDevices'),
  validateParams(edgeDeviceIdParamSchema),
  validateBody(updateEdgeDeviceSchema),
  edgeDeviceController.updateEdgeDevice,
)

router.delete(
  '/edge-devices/:id',
  requirePermission('deleteEdgeDevices'),
  validateParams(edgeDeviceIdParamSchema),
  edgeDeviceController.deleteEdgeDevice,
)

export default router
