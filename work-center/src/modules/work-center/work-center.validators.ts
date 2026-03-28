import { z } from 'zod'
import { paginationSchema } from '../../utils/pagination.js'
import { objectIdSchema } from '../../utils/validators.js'

// ── Shared field schemas ─────────────────────────────────────────────────────

const codeSchema = z.string().trim().min(1).max(50)
const nameSchema = z.string().trim().min(1).max(100)
const descriptionSchema = z.string().max(500).nullable()

const propsSchema = z.record(z.string(), z.string())

const shiftIdsSchema = z.array(objectIdSchema)

// ── Tag bindings (physical) ──────────────────────────────────────────────────

const tagBindingsSchema = z.object({
  productionCounterTagId: objectIdSchema,
  runModeTagId: objectIdSchema,
  speedTagId: objectIdSchema.nullable().optional(),
}).strict()

// ── Action settings (physical, requires attentionSignalTagId) ────────────────

const actionSettingsSchema = z.object({
  jobOrderMissingThresholdMs: z.number().int().min(0),
  operatorMissingThresholdMs: z.number().int().min(0),
  uncausedDowntimeThresholdMs: z.number().int().min(0),
  downtimeConfirmationDeadlineMs: z.number().int().min(0),
  serviceOverrunThresholdMs: z.number().int().min(0),
}).strict()

// ── Metric composition (virtual) ─────────────────────────────────────────────

const contributorSchema = z.object({
  workCenterId: objectIdSchema,
  weight: z.number().min(0).max(1).optional(),
}).strict()

const compositionRuleSchema = z.discriminatedUnion('rule', [
  z.object({
    rule: z.literal('primary_work_center'),
    contributors: z.array(contributorSchema).length(1),
  }).strict(),
  z.object({
    rule: z.literal('average'),
    contributors: z.array(contributorSchema).min(2),
  }).strict(),
  z.object({
    rule: z.literal('weighted'),
    contributors: z
      .array(
        z.object({
          workCenterId: objectIdSchema,
          weight: z.number().min(0).max(1),
        }).strict(),
      )
      .min(2)
      .refine(cs => Math.abs(cs.reduce((sum, c) => sum + c.weight, 0) - 1) <= 0.001, {
        message: 'work_center.composition_weights_must_sum_to_one',
      }),
  }).strict(),
])

const metricCompositionSchema = z.object({
  availability: compositionRuleSchema,
  productivity: compositionRuleSchema,
  quality: compositionRuleSchema,
}).strict()

// ── Partial composition (for PATCH per-family merge) ─────────────────────────

const partialMetricCompositionSchema = z
  .object({
    availability: compositionRuleSchema.optional(),
    productivity: compositionRuleSchema.optional(),
    quality: compositionRuleSchema.optional(),
  })
  .strict()
  .refine(obj => obj.availability || obj.productivity || obj.quality, {
    message: 'work_center.composition_at_least_one_family',
  })

// ── Create schemas (discriminated union on type) ─────────────────────────────

const baseCreateFields = {
  code: codeSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  parentWorkCenterId: objectIdSchema.nullable().optional(),
  props: propsSchema.optional(),
  shiftIds: shiftIdsSchema.optional(),
}

const physicalCreateSchema = z
  .object({
    ...baseCreateFields,
    type: z.literal('physical'),
    productivityMode: z.enum(['count_based', 'speed_based']),
    tagBindings: tagBindingsSchema,
    attentionSignalTagId: objectIdSchema.nullable().optional(),
    actionSettings: actionSettingsSchema.optional(),
    microStopThresholdMs: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    data => {
      if (data.productivityMode === 'speed_based') {
        return !!data.tagBindings.speedTagId
      }
      return true
    },
    { message: 'work_center.speed_tag_required', path: ['tagBindings', 'speedTagId'] },
  )
  .refine(
    data => {
      if (data.actionSettings && !data.attentionSignalTagId) {
        return false
      }
      return true
    },
    {
      message: 'work_center.action_settings_requires_attention_signal',
      path: ['actionSettings'],
    },
  )

const virtualCreateSchema = z.object({
  ...baseCreateFields,
  type: z.literal('virtual'),
  metricComposition: metricCompositionSchema.nullable().optional(),
}).strict()

export const createWorkCenterSchema = z.discriminatedUnion('type', [
  physicalCreateSchema,
  virtualCreateSchema,
])

// ── Replace (PUT) schemas ────────────────────────────────────────────────────
// Same as create but type is not accepted (immutable, inferred from existing doc)

const physicalReplaceSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    parentWorkCenterId: objectIdSchema.nullable().optional(),
    props: propsSchema.optional(),
    shiftIds: shiftIdsSchema.optional(),
    productivityMode: z.enum(['count_based', 'speed_based']),
    tagBindings: tagBindingsSchema,
    attentionSignalTagId: objectIdSchema.nullable().optional(),
    actionSettings: actionSettingsSchema.nullable().optional(),
    microStopThresholdMs: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    data => {
      if (data.productivityMode === 'speed_based') {
        return !!data.tagBindings.speedTagId
      }
      return true
    },
    { message: 'work_center.speed_tag_required', path: ['tagBindings', 'speedTagId'] },
  )
  .refine(
    data => {
      if (data.actionSettings && !data.attentionSignalTagId) {
        return false
      }
      return true
    },
    {
      message: 'work_center.action_settings_requires_attention_signal',
      path: ['actionSettings'],
    },
  )

const virtualReplaceSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  parentWorkCenterId: objectIdSchema.nullable().optional(),
  props: propsSchema.optional(),
  shiftIds: shiftIdsSchema.optional(),
  metricComposition: metricCompositionSchema.nullable().optional(),
}).strict()

export { physicalReplaceSchema, virtualReplaceSchema }

// ── Patch schema ─────────────────────────────────────────────────────────────
// All fields optional. Type-specific field rejection happens in service layer.

export const patchWorkCenterSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    parentWorkCenterId: objectIdSchema.nullable().optional(),
    props: propsSchema.optional(),
    shiftIds: shiftIdsSchema.optional(),
    status: z.enum(['active', 'archived']).optional(),
    // Physical fields
    productivityMode: z.enum(['count_based', 'speed_based']).optional(),
    tagBindings: tagBindingsSchema.optional(),
    attentionSignalTagId: objectIdSchema.nullable().optional(),
    actionSettings: actionSettingsSchema.nullable().optional(),
    microStopThresholdMs: z.number().int().min(0).optional(),
    // Virtual fields
    metricComposition: metricCompositionSchema.nullable().optional(),
    partialMetricComposition: partialMetricCompositionSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, {
    message: 'error.empty_patch',
  })

// ── Param / query schemas ────────────────────────────────────────────────────

export const workCenterIdParamSchema = z.object({
  id: objectIdSchema,
})

export const workCenterListSchema = paginationSchema.extend({
  type: z.enum(['physical', 'virtual']).optional(),
  status: z.enum(['active', 'archived']).optional(),
  parentWorkCenterId: objectIdSchema.nullable().optional(),
})

// ── Type exports ─────────────────────────────────────────────────────────────

export type CreateWorkCenterInput = z.infer<typeof createWorkCenterSchema>
export type PatchWorkCenterInput = z.infer<typeof patchWorkCenterSchema>
export type WorkCenterListInput = z.infer<typeof workCenterListSchema>

export {
  metricCompositionSchema,
  partialMetricCompositionSchema,
  contributorSchema,
  compositionRuleSchema,
}
