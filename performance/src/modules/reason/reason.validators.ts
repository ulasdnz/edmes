import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'
import { REASON_USAGES } from './reason.model.js'

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9_-]+$/, { message: 'error.invalid_code' })

const nameSchema = z.string().trim().min(1).max(128)

const usageSchema = z.enum(REASON_USAGES)

const usageArraySchema = z.array(usageSchema).min(1)

const propsSchema = z.record(z.string(), z.unknown())

const hasStopUsage = (usages: readonly string[]): boolean =>
  usages.some(u => u === 'planned_stop' || u === 'unplanned_stop')

export const createReasonSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    description: z.string().trim().max(500).nullable().optional(),
    usages: usageArraySchema,
    affectsOee: z.boolean().optional(),
    workCenterIds: z.array(objectIdSchema).optional(),
    canStartManually: z.boolean().optional(),
    canBeScheduled: z.boolean().optional(),
    canConvertFromUnplanned: z.boolean().optional(),
    requiresDescription: z.boolean().optional(),
    isActive: z.boolean().optional(),
    props: propsSchema.optional(),
  })
  .strict()
  .refine(
    d => {
      const flagsSet =
        d.canStartManually !== undefined ||
        d.canBeScheduled !== undefined ||
        d.canConvertFromUnplanned !== undefined
      if (!flagsSet) return true
      return hasStopUsage(d.usages)
    },
    { message: 'error.reason_stop_flags_require_stop_usage' },
  )

export const patchReasonSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    usages: usageArraySchema.optional(),
    affectsOee: z.boolean().optional(),
    workCenterIds: z.array(objectIdSchema).optional(),
    canStartManually: z.boolean().optional(),
    canBeScheduled: z.boolean().optional(),
    canConvertFromUnplanned: z.boolean().optional(),
    requiresDescription: z.boolean().optional(),
    isActive: z.boolean().optional(),
    props: propsSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const reasonIdParamSchema = z.object({ id: objectIdSchema })

const csvUsages = z
  .string()
  .transform(v =>
    v
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(usageSchema).min(1))

const fieldsSchema = z
  .string()
  .transform(v =>
    v
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(['_id'])).min(1))

export const reasonListSchema = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().optional(),
  usage: csvUsages.optional(),
  affectsOee: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  isSystemDefault: z.coerce.boolean().optional(),
  workCenterId: objectIdSchema.optional(),
  fields: fieldsSchema.optional(),
})

export type CreateReasonInput = z.infer<typeof createReasonSchema>
export type PatchReasonInput = z.infer<typeof patchReasonSchema>
export type ReasonListInput = z.infer<typeof reasonListSchema>
