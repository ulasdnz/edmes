import type { Request, Response } from 'express'
import { calculate } from './oee.service.js'
import type { OeeQuery } from './oee.validators.js'

export const getOee = async (req: Request, res: Response) => {
  const { workCenterId, from, to } = req.query as unknown as OeeQuery
  const result = await calculate({
    workCenterId,
    from,
    to,
    userId: req.user!.id,
    workCenterIds: req.user!.workCenterIds,
  })
  res.json({ data: result })
}
