import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const nameSchema = z
  .string({ message: 'validation.tag_type_name_required' })
  .trim()
  .min(2, { message: 'validation.tag_type_name_min' })
  .max(50, { message: 'validation.tag_type_name_max' })

export const createTagTypeSchema = z
  .object({
    name: nameSchema,
    desc: z.string().nullable().optional(),
    unit: z.string().trim().nullable().optional(),
    displayColor: z.string().trim().nullable().optional(),
    manualEntryMode: z.enum(['none', 'number', 'boolean']).optional(),
  })
  .strict()

export const updateTagTypeSchema = z
  .object({
    name: nameSchema.optional(),
    desc: z.string().nullable().optional(),
    unit: z.string().trim().nullable().optional(),
    displayColor: z.string().trim().nullable().optional(),
    manualEntryMode: z.enum(['none', 'number', 'boolean']).optional(),
  })
  .strict()

export const tagTypeIdParamSchema = z.object({
  id: objectIdSchema,
})

export type CreateTagTypeInput = z.infer<typeof createTagTypeSchema>
export type UpdateTagTypeInput = z.infer<typeof updateTagTypeSchema>
