import { paginationSchema } from '@mes/core/pagination'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const codeSchema = z.string().trim().min(1).max(50)
const nameSchema = z.string().trim().min(1).max(200)

export const createProductSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    description: z.string().max(500).nullable().optional(),
    categoryId: objectIdSchema.nullable().optional(),
    kind: z.enum(['finished', 'semi_finished']),
    uomId: objectIdSchema,
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export const patchProductSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    description: z.string().max(500).nullable().optional(),
    categoryId: objectIdSchema.nullable().optional(),
    kind: z.enum(['finished', 'semi_finished']).optional(),
    uomId: objectIdSchema.optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const productIdParamSchema = z.object({ id: objectIdSchema })

export const productListSchema = paginationSchema.extend({
  _id: objectIdSchema.optional(),
  code: z.string().optional(),
  kind: z.enum(['finished', 'semi_finished']).optional(),
  categoryId: objectIdSchema.optional(),
  uomId: objectIdSchema.optional(),
})

export type CreateProductInput = z.infer<typeof createProductSchema>
export type PatchProductInput = z.infer<typeof patchProductSchema>
export type ProductListInput = z.infer<typeof productListSchema>
