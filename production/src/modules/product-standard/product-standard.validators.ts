import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { paginationSchema } from '../../utils/pagination.js'
import { objectIdSchema } from '../../utils/validators.js'

export const createProductStandardSchema = z.object({
  productId: objectIdSchema,
  workCenterId: objectIdSchema,
  validFrom: utcDateSchema.optional(),
  idealOutputPerMinute: z.number().positive(),
  counterMultiplier: z.number().positive().nullable().optional(),
  idealSpeed: z.number().positive().nullable().optional(),
}).strict()

export const patchProductStandardSchema = z
  .object({
    idealOutputPerMinute: z.number().positive().optional(),
    counterMultiplier: z.number().positive().nullable().optional(),
    idealSpeed: z.number().positive().nullable().optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const productStandardIdParamSchema = z.object({ id: objectIdSchema })

export const productStandardListSchema = paginationSchema.extend({
  _id: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  workCenterId: objectIdSchema.optional(),
  createdBy: objectIdSchema.optional(),
  validFromFrom: utcDateSchema.optional(),
  validFromTo: utcDateSchema.optional(),
  createdAtFrom: utcDateSchema.optional(),
  createdAtTo: utcDateSchema.optional(),
})

export type CreateProductStandardInput = z.infer<typeof createProductStandardSchema>
export type PatchProductStandardInput = z.infer<typeof patchProductStandardSchema>
export type ProductStandardListInput = z.infer<typeof productStandardListSchema>
