import { codeSchema, utcDateSchema } from '@mes/core'
import { paginationSchema } from '@mes/core/pagination'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

export const createJobOrderSchema = z
  .object({
    code: codeSchema,
    productId: objectIdSchema,
    workCenterId: objectIdSchema,
    productionPlanId: objectIdSchema.nullable().optional(),
    targetQuantity: z.number().positive(),
    plannedStartAt: utcDateSchema.nullable().optional(),
    dueAt: utcDateSchema.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export const patchJobOrderSchema = z
  .object({
    code: codeSchema.optional(),
    productId: objectIdSchema.optional(),
    workCenterId: objectIdSchema.optional(),
    productionPlanId: objectIdSchema.nullable().optional(),
    targetQuantity: z.number().positive().optional(),
    plannedStartAt: utcDateSchema.nullable().optional(),
    dueAt: utcDateSchema.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const jobOrderIdParamSchema = z.object({ id: objectIdSchema })

export const startJobOrderSchema = z
  .object({
    startTime: utcDateSchema.optional(),
  })
  .strict()

export const endJobOrderSchema = z
  .object({
    endTime: utcDateSchema.optional(),
  })
  .strict()

export const jobOrderListSchema = paginationSchema.extend({
  _id: objectIdSchema.optional(),
  code: codeSchema.optional(),
  productId: objectIdSchema.optional(),
  workCenterId: objectIdSchema.optional(),
  productionPlanId: objectIdSchema.optional(),
  createdBy: objectIdSchema.optional(),
  startedBy: objectIdSchema.optional(),
  endedBy: objectIdSchema.optional(),
  workCenterIds: z.string().optional(),
  productIds: z.string().optional(),
  runtimeState: z.enum(['pending', 'running', 'finished']).optional(),
  activeFrom: utcDateSchema.optional(),
  activeTo: utcDateSchema.optional(),
  plannedStartAtFrom: utcDateSchema.optional(),
  plannedStartAtTo: utcDateSchema.optional(),
  startTimeFrom: utcDateSchema.optional(),
  startTimeTo: utcDateSchema.optional(),
  endTimeFrom: utcDateSchema.optional(),
  endTimeTo: utcDateSchema.optional(),
  dueAtFrom: utcDateSchema.optional(),
  dueAtTo: utcDateSchema.optional(),
  createdAtFrom: utcDateSchema.optional(),
  createdAtTo: utcDateSchema.optional(),
})

export type CreateJobOrderInput = z.infer<typeof createJobOrderSchema>
export type PatchJobOrderInput = z.infer<typeof patchJobOrderSchema>
export type StartJobOrderInput = z.infer<typeof startJobOrderSchema>
export type EndJobOrderInput = z.infer<typeof endJobOrderSchema>
export type JobOrderListInput = z.infer<typeof jobOrderListSchema>
