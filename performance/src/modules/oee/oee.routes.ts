import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateQuery } from '../../core/middleware/validate.js'
import * as controller from './oee.controller.js'
import { oeeQuerySchema } from './oee.validators.js'

const router = Router()

router.get('/oee', requirePermission('readOee'), validateQuery(oeeQuerySchema), controller.getOee)

export default router
