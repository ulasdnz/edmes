import type { Request, Response } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { validateParams } from '../../core/middleware/validate.js'
import { objectIdSchema } from '../../utils/validators.js'
import { JobOrder } from '../job-order/job-order.model.js'
import { ProductStandard } from '../product-standard/product-standard.model.js'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'

const workCenterIdParamSchema = z.object({ id: objectIdSchema })

const router = Router()

router.get(
  '/work-centers/:id/references',
  validateParams(workCenterIdParamSchema),
  async (req: Request<{ id: string }>, res: Response) => {
    const wcId = req.params.id

    const [totalRefs, startedJOs] = await Promise.all([
      Promise.all([
        ProductStandard.countDocuments({ workCenterId: wcId }),
        JobOrder.countDocuments({ workCenterId: wcId }),
        QuantityAdjustment.countDocuments({ workCenterId: wcId }),
        ScrapEntry.countDocuments({ workCenterId: wcId }),
      ]).then(counts => counts.reduce((a, b) => a + b, 0)),
      JobOrder.countDocuments({ workCenterId: wcId, startTime: { $ne: null } }),
    ])

    res.json({
      data: {
        inUse: totalRefs > 0,
        hasStartedJobOrders: startedJOs > 0,
      },
    })
  },
)

export default router
