/**
 * Internal-only user routes — mounted on /internal/v1 alone, never on the public API.
 */

import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as userController from './user.controller.js'
import { addUserWorkCenterSchema, userIdParamSchema } from './user.validators.js'

const router = Router()

// work-center grants the creator access to a work center it just created
router.post(
  '/users/:id/work-center-ids',
  validateParams(userIdParamSchema),
  validateBody(addUserWorkCenterSchema),
  userController.addUserWorkCenter,
)

export default router
