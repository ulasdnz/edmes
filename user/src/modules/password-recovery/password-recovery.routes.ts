import { Router } from 'express'
import { validateBody } from '../../core/middleware/validate.js'
import * as passwordRecoveryController from './password-recovery.controller.js'
import {
  requestCodeSchema,
  verificationAndUpdateSchema,
  verificationCodeSchema,
} from './password-recovery.validators.js'

const router = Router()

// ─── Public routes (no authentication required) ──────────────────────────────

router.post(
  '/password-recoveries',
  validateBody(requestCodeSchema),
  passwordRecoveryController.requestCode,
)

router.post(
  '/password-recoveries/verification',
  validateBody(verificationCodeSchema),
  passwordRecoveryController.verifyCode,
)

router.post(
  '/password-recoveries/verification-and-update',
  validateBody(verificationAndUpdateSchema),
  passwordRecoveryController.verificationAndUpdate,
)

export default router
