import { utcDateSchema } from '@mes/core'
import { paginationSchema } from '@mes/core/pagination'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const codeSchema = z.string().trim().min(1).max(50)

export const createProductionPlanSchema = z
  .object({
    code: codeSchema,
    productId: objectIdSchema,
    targetQuantity: z.number().positive(),
    dueAt: utcDateSchema.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export const patchProductionPlanSchema = z
  .object({
    code: codeSchema.optional(),
    productId: objectIdSchema.optional(),
    targetQuantity: z.number().positive().optional(),
    dueAt: utcDateSchema.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const productionPlanIdParamSchema = z.object({ id: objectIdSchema })

export const productionPlanListSchema = paginationSchema.extend({
  _id: objectIdSchema.optional(),
  code: z.string().optional(),
  productId: objectIdSchema.optional(),
  createdBy: objectIdSchema.optional(),
  dueAtFrom: utcDateSchema.optional(),
  dueAtTo: utcDateSchema.optional(),
  createdAtFrom: utcDateSchema.optional(),
  createdAtTo: utcDateSchema.optional(),
})

export type CreateProductionPlanInput = z.infer<typeof createProductionPlanSchema>
export type PatchProductionPlanInput = z.infer<typeof patchProductionPlanSchema>
export type ProductionPlanListInput = z.infer<typeof productionPlanListSchema>
