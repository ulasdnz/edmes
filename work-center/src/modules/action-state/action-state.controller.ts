import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { IActionState } from './action-state.model.js'
import * as actionStateService from './action-state.service.js'

export const ingestActionState = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<IActionState>>,
) => {
  const state = await actionStateService.ingestActionState(
    req.params.workCenterId,
    req.body,
    req.user!.id,
  )
  res.json({ message: req.t('success.action_state'), data: state })
}

export const getLatestActionState = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<IActionState | null>>,
) => {
  const state = await actionStateService.getLatestActionState(req.params.workCenterId)
  res.json({ data: state })
}
