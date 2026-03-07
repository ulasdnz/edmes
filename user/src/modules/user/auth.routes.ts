/**
 * Public authentication routes — no auth middleware required.
 * Mounted BEFORE the authenticate middleware in express.ts.
 */

import { Router } from 'express'
import { validateBody } from '../../core/middleware/validate.js'
import * as userController from './user.controller.js'
import { loginSchema, registerSchema } from './user.validators.js'

const router = Router()

router.post('/auth/register', validateBody(registerSchema), userController.register)
router.post('/auth/login', validateBody(loginSchema), userController.login)

export default router
