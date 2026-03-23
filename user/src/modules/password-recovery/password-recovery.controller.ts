import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import * as passwordRecoveryService from './password-recovery.service.js'
import type {
  RequestCodeInput,
  VerificationAndUpdateInput,
  VerificationCodeInput,
} from './password-recovery.validators.js'

export const requestCode = async (
  req: Request<unknown, unknown, RequestCodeInput>,
  res: Response<SuccessResponse<{ email: string; expiredAt: Date }>>,
) => {
  const result = await passwordRecoveryService.requestCode(req.body)

  res.json({
    data: result,
    message: req.t('success.create'),
  })
}

export const verifyCode = async (
  req: Request<unknown, unknown, VerificationCodeInput>,
  res: Response<SuccessResponse<{ email: string; expiredAt: Date }>>,
) => {
  const result = await passwordRecoveryService.verifyCode(req.body)

  res.json({
    data: result,
    message: req.t('success.verify'),
  })
}

export const verificationAndUpdate = async (
  req: Request<unknown, unknown, VerificationAndUpdateInput>,
  res: Response<SuccessResponse<void>>,
) => {
  await passwordRecoveryService.verificationAndUpdate(req.body)

  res.json({
    data: undefined,
    message: req.t('success.update'),
  })
}
