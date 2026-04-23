import type { Request, Response } from 'express'
import { Router } from 'express'
import { validateBody } from '../../core/middleware/validate.js'
import { findJobOrderRecordsBatch } from './job-order-records-batch.service.js'
import {
  type JobOrderRecordsBatchInput,
  jobOrderRecordsBatchSchema,
} from './job-order-records-batch.validators.js'

const router = Router()

router.post(
  '/job-order-records:batch',
  validateBody(jobOrderRecordsBatchSchema),
  async (req: Request<unknown, unknown, JobOrderRecordsBatchInput>, res: Response) => {
    const result = await findJobOrderRecordsBatch(req.body)
    res.json({ data: result })
  },
)

export default router
