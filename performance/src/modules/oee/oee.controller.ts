import type { Request, Response } from 'express'
import { calculate } from './oee.service.js'

export const getOee = async (req: Request, res: Response) => {
  const { workCenterId, from, to } = req.query as {
    workCenterId: string
    from: string
    to: string
  }
  const result = await calculate({
    workCenterId,
    from: new Date(from),
    to: new Date(to),
    userId: req.user!.id,
  })
  res.json({ data: result })
}
