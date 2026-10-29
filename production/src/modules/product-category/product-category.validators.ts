import { paginationSchema } from '@mes/core/pagination'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const codeSchema = z.string().trim().min(1).max(50)
const nameSchema = z.string().trim().min(1).max(100)

export const createProductCategorySchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    description: z.string().max(500).nullable().optional(),
  })
  .strict()

export const patchProductCategorySchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const productCategoryIdParamSchema = z.object({ id: objectIdSchema })

export const productCategoryListSchema = paginationSchema.extend({
  code: z.string().optional(),
  name: z.string().optional(),
})

export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>
export type PatchProductCategoryInput = z.infer<typeof patchProductCategorySchema>
export type ProductCategoryListInput = z.infer<typeof productCategoryListSchema>
