import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const nameSchema = z
  .string({ message: 'validation.tag_name_required' })
  .trim()
  .min(2, { message: 'validation.tag_name_min' })
  .max(100, { message: 'validation.tag_name_max' })

const bindingSchema = z
  .object({
    deviceKey: z.string().trim().min(1),
    nodeId: z.string().trim().nullable().optional(),
  })
  .strict()

export const createTagSchema = z
  .object({
    name: nameSchema,
    desc: z.string().nullable().optional(),
    tagTypeId: objectIdSchema,
    behavior: z.enum(['counter', 'speed', 'binary']),
    digit: z.number().int().min(0).optional(),
    tolerance: z.number().min(0).optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    writable: z.boolean().optional(),
    showOnGraph: z.boolean().optional(),
    retentionPolicy: z.string().nullable().optional(),
    binding: bindingSchema.nullable().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const updateTagSchema = z
  .object({
    name: nameSchema.optional(),
    desc: z.string().nullable().optional(),
    tagTypeId: objectIdSchema.optional(),
    digit: z.number().int().min(0).optional(),
    tolerance: z.number().min(0).optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    writable: z.boolean().optional(),
    showOnGraph: z.boolean().optional(),
    retentionPolicy: z.string().nullable().optional(),
    binding: bindingSchema.nullable().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const tagIdParamSchema = z.object({
  id: objectIdSchema,
})

export type CreateTagInput = z.infer<typeof createTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>
