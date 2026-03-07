import { Router } from 'express'
import { getHealth, getLiveness, getReadiness } from './health.controller.js'

const router = Router()

router.get('/health', getHealth)
router.get('/health/ready', getReadiness)
router.get('/health/live', getLiveness)

export default router
