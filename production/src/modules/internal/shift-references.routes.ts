import type { Request, Response } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { validateParams } from '../../core/middleware/validate.js'
import { objectIdSchema } from '../../utils/validators.js'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'

const shiftIdParamSchema = z.object({ id: objectIdSchema })

const router = Router()

router.get(
  '/shifts/:id/references',
  validateParams(shiftIdParamSchema),
  async (req: Request<{ id: string }>, res: Response) => {
    const shiftId = req.params.id
    const [qa, scrap] = await Promise.all([
      QuantityAdjustment.countDocuments({ shiftId }),
      ScrapEntry.countDocuments({ shiftId }),
    ])
    res.json({ data: { inUse: qa + scrap > 0 } })
  },
)

export default router
