import { utcDateSchema } from '@mes/core'
import { paginationSchema } from '@mes/core/pagination'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const descriptionSchema = z.string().trim().max(1000)
const propsSchema = z.record(z.string(), z.unknown())

export const createUnplannedStopSchema = z
  .object({
    workCenterId: objectIdSchema,
    startAt: utcDateSchema,
    reasonId: objectIdSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()

export const patchUnplannedStopSchema = z
  .object({
    workCenterId: z.never({ message: 'error.unplanned_stop_work_center_immutable' }).optional(),
    reasonId: objectIdSchema.nullable().optional(),
    description: descriptionSchema.nullable().optional(),
    approvedAt: utcDateSchema.nullable().optional(),
    approvedBy: objectIdSchema.nullable().optional(),
    props: propsSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const closeUnplannedStopSchema = z
  .object({
    endAt: utcDateSchema.optional(),
    reasonId: objectIdSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()

export const convertToPlannedSchema = z
  .object({
    plannedStopId: objectIdSchema.optional(),
    reasonId: objectIdSchema.optional(),
    plannedOwnerId: objectIdSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()

export const unplannedStopIdParamSchema = z.object({ id: objectIdSchema })

export const unplannedStopListSchema = paginationSchema.extend({
  workCenterId: objectIdSchema.optional(),
  reasonId: objectIdSchema.optional(),
  state: z.enum(['open', 'closed', 'converted']).optional(),
  from: utcDateSchema.optional(),
  to: utcDateSchema.optional(),
})
