import { paginationSchema } from '@mes/core/pagination'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const codeSchema = z.string().trim().min(1).max(50)
const nameSchema = z.string().trim().min(1).max(100)
const symbolSchema = z.string().trim().min(1).max(20)

export const createUomSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    symbol: symbolSchema,
  })
  .strict()

export const patchUomSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    symbol: symbolSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const uomIdParamSchema = z.object({ id: objectIdSchema })

export const uomListSchema = paginationSchema.extend({
  code: z.string().optional(),
  name: z.string().optional(),
  symbol: z.string().optional(),
})

export type CreateUomInput = z.infer<typeof createUomSchema>
export type PatchUomInput = z.infer<typeof patchUomSchema>
export type UomListInput = z.infer<typeof uomListSchema>
