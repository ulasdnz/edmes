import { z } from 'zod'
import { paginationSchema } from '../../utils/pagination.js'
import { objectIdSchema } from '../../utils/validators.js'

const codeSchema = z.string().trim().min(1).max(50)

export const createJobOrderSchema = z.object({
  code: codeSchema,
  productId: objectIdSchema,
  workCenterId: objectIdSchema,
  productionPlanId: objectIdSchema.nullable().optional(),
  targetQuantity: z.number().positive(),
  plannedStartAt: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  props: z.record(z.string(), z.string()).optional(),
}).strict()

export const patchJobOrderSchema = z
  .object({
    code: codeSchema.optional(),
    productId: objectIdSchema.optional(),
    workCenterId: objectIdSchema.optional(),
    productionPlanId: objectIdSchema.nullable().optional(),
    targetQuantity: z.number().positive().optional(),
    plannedStartAt: z.coerce.date().nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const jobOrderIdParamSchema = z.object({ id: objectIdSchema })

export const startJobOrderSchema = z.object({
  startTime: z.coerce.date().optional(),
}).strict()

export const endJobOrderSchema = z.object({
  endTime: z.coerce.date().optional(),
}).strict()

export const jobOrderListSchema = paginationSchema.extend({
  _id: objectIdSchema.optional(),
  code: z.string().optional(),
  productId: objectIdSchema.optional(),
  workCenterId: objectIdSchema.optional(),
  productionPlanId: objectIdSchema.optional(),
  createdBy: objectIdSchema.optional(),
  startedBy: objectIdSchema.optional(),
  endedBy: objectIdSchema.optional(),
  workCenterIds: z.string().optional(),
  productIds: z.string().optional(),
  runtimeState: z.enum(['pending', 'running', 'finished']).optional(),
  activeFrom: z.coerce.date().optional(),
  activeTo: z.coerce.date().optional(),
  plannedStartAtFrom: z.coerce.date().optional(),
  plannedStartAtTo: z.coerce.date().optional(),
  startTimeFrom: z.coerce.date().optional(),
  startTimeTo: z.coerce.date().optional(),
  endTimeFrom: z.coerce.date().optional(),
  endTimeTo: z.coerce.date().optional(),
  dueAtFrom: z.coerce.date().optional(),
  dueAtTo: z.coerce.date().optional(),
  createdAtFrom: z.coerce.date().optional(),
  createdAtTo: z.coerce.date().optional(),
})

export type CreateJobOrderInput = z.infer<typeof createJobOrderSchema>
export type PatchJobOrderInput = z.infer<typeof patchJobOrderSchema>
export type StartJobOrderInput = z.infer<typeof startJobOrderSchema>
export type EndJobOrderInput = z.infer<typeof endJobOrderSchema>
export type JobOrderListInput = z.infer<typeof jobOrderListSchema>
