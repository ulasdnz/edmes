import { z } from 'zod'
import { paginationSchema } from '../../utils/pagination.js'
import { objectIdSchema } from '../../utils/validators.js'

export const createQuantityAdjustmentSchema = z.object({
  jobOrderId: objectIdSchema,
  shiftId: objectIdSchema,
  amount: z.number(),
  time: z.coerce.date(),
  reason: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
}).strict()

export const patchQuantityAdjustmentSchema = z
  .object({
    shiftId: objectIdSchema.optional(),
    amount: z.number().optional(),
    time: z.coerce.date().optional(),
    reason: z.string().max(200).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const quantityAdjustmentIdParamSchema = z.object({ id: objectIdSchema })

export const quantityAdjustmentListSchema = paginationSchema.extend({
  _id: objectIdSchema.optional(),
  jobOrderId: objectIdSchema.optional(),
  workCenterId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  shiftId: objectIdSchema.optional(),
  createdBy: objectIdSchema.optional(),
  timeFrom: z.coerce.date().optional(),
  timeTo: z.coerce.date().optional(),
  createdAtFrom: z.coerce.date().optional(),
  createdAtTo: z.coerce.date().optional(),
})

export type CreateQuantityAdjustmentInput = z.infer<typeof createQuantityAdjustmentSchema>
export type PatchQuantityAdjustmentInput = z.infer<typeof patchQuantityAdjustmentSchema>
export type QuantityAdjustmentListInput = z.infer<typeof quantityAdjustmentListSchema>
