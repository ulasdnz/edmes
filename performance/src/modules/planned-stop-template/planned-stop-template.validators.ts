import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'
import { OVERRUN_POLICIES } from './planned-stop-template.model.js'

const nameSchema = z.string().trim().min(1).max(128)
const descriptionSchema = z.string().trim().max(1000)
const propsSchema = z.record(z.string(), z.unknown())

export const createTemplateSchema = z
  .object({
    workCenterIds: z.array(objectIdSchema).optional(),
    reasonId: objectIdSchema,
    name: nameSchema,
    description: descriptionSchema.nullable().optional(),
    defaultDurationMs: z.number().int().min(1),
    plannedOwnerId: objectIdSchema.optional(),
    responsibleUserId: objectIdSchema.optional(),
    overrunPolicy: z.enum(OVERRUN_POLICIES),
    overrunReasonId: objectIdSchema.optional(),
    isActive: z.boolean().optional(),
    props: propsSchema.optional(),
  })
  .strict()

export const patchTemplateSchema = z
  .object({
    reasonId: objectIdSchema.optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    defaultDurationMs: z.number().int().min(1).optional(),
    plannedOwnerId: objectIdSchema.nullable().optional(),
    responsibleUserId: objectIdSchema.nullable().optional(),
    overrunPolicy: z.enum(OVERRUN_POLICIES).optional(),
    overrunReasonId: objectIdSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    props: propsSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const startTemplateSchema = z
  .object({
    workCenterId: objectIdSchema,
    actualStartAt: utcDateSchema.optional(),
    description: descriptionSchema.optional(),
    plannedDurationMs: z.number().int().min(1).optional(),
  })
  .strict()

export const closeTemplateSchema = z
  .object({
    plannedStopId: objectIdSchema,
    actualEndAt: utcDateSchema.optional(),
  })
  .strict()

export const templateIdParamSchema = z.object({ id: objectIdSchema })

export const templateListSchema = z.object({
  workCenterId: objectIdSchema.optional(),
  reasonId: objectIdSchema.optional(),
  isActive: z.coerce.boolean().optional(),
})

export type TemplateListInput = z.infer<typeof templateListSchema>
