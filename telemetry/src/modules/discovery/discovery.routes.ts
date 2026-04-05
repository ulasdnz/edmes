import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateQuery } from '../../core/middleware/validate.js'
import * as discoveryController from './discovery.controller.js'
import { discoveryQuerySchema } from './discovery.validators.js'

const router = Router()

router.get(
  '/discovery',
  requirePermission('readDiscovery'),
  validateQuery(discoveryQuerySchema),
  discoveryController.getAllManifests,
)

router.get(
  '/discovery/:deviceKey',
  requirePermission('readDiscovery'),
  validateQuery(discoveryQuerySchema),
  discoveryController.getManifestByDevice,
)

export default router
