import type { Request, Response } from 'express'
import { Router } from 'express'
import { validateBody } from '../../core/middleware/validate.js'
import { findTimelinesBatch } from '../product-standard/product-standard.service.js'
import {
  type TimelinesBatchInput,
  timelinesBatchSchema,
} from '../product-standard/product-standard.validators.js'

const router = Router()

router.post(
  '/product-standards/timelines:batch',
  validateBody(timelinesBatchSchema),
  async (req: Request<unknown, unknown, TimelinesBatchInput>, res: Response) => {
    const result = await findTimelinesBatch(req.body)
    res.json({ data: result })
  },
)

export default router
