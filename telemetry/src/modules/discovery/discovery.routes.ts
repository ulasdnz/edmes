import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import * as discoveryController from './discovery.controller.js'

const router = Router()

router.get('/discovery', requirePermission('readDiscovery'), discoveryController.getAllManifests)

router.get(
  '/discovery/:deviceKey',
  requirePermission('readDiscovery'),
  discoveryController.getManifestByDevice,
)

export default router
