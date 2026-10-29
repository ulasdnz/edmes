import type { Request, Response } from 'express'
import { Router } from 'express'
import { validateQuery } from '../../core/middleware/validate.js'
import { findJobOrderWindows } from './job-order-windows.service.js'
import {
  type JobOrderWindowsQuery,
  jobOrderWindowsQuerySchema,
} from './job-order-windows.validators.js'

const router = Router()

router.get(
  '/job-order-windows',
  validateQuery(jobOrderWindowsQuerySchema),
  async (req: Request, res: Response) => {
    const result = await findJobOrderWindows(req.query as unknown as JobOrderWindowsQuery)
    res.json({ data: result })
  },
)

export default router
