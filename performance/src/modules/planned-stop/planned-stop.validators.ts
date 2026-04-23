import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { paginationSchema } from '../../utils/pagination.js'
import { objectIdSchema } from '../../utils/validators.js'
import { PLANNED_STOP_STATUSES } from './planned-stop.model.js'

const descriptionSchema = z.string().trim().max(1000)
const propsSchema = z.record(z.string(), z.unknown())

export const createPlannedStopSchema = z
  .object({
    workCenterId: objectIdSchema,
    reasonId: objectIdSchema,
    plannedOwnerId: objectIdSchema,
    plannedStartAt: utcDateSchema,
    plannedEndAt: utcDateSchema,
    actualStartAt: utcDateSchema.optional(),
    actualEndAt: utcDateSchema.optional(),
    status: z.enum(['planned', 'closed']).optional(),
    startMode: z.enum(['automatic', 'manual']).optional(),
    description: descriptionSchema.optional(),
    props: propsSchema.optional(),
  })
  .strict()

export const patchPlannedStopSchema = z
  .object({
    workCenterId: z.never({ message: 'error.planned_stop_work_center_immutable' }).optional(),
    reasonId: objectIdSchema.optional(),
    plannedOwnerId: objectIdSchema.optional(),
    plannedStartAt: utcDateSchema.optional(),
    plannedEndAt: utcDateSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    props: propsSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const closePlannedStopSchema = z
  .object({
    actualEndAt: utcDateSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()

export const startPlannedStopSchema = z
  .object({
    actualStartAt: utcDateSchema.optional(),
  })
  .strict()

export const plannedStopIdParamSchema = z.object({ id: objectIdSchema })

export const plannedStopListSchema = paginationSchema.extend({
  workCenterId: objectIdSchema.optional(),
  reasonId: objectIdSchema.optional(),
  status: z.enum(PLANNED_STOP_STATUSES).optional(),
  from: utcDateSchema.optional(),
  to: utcDateSchema.optional(),
})

export type CreatePlannedStopBody = z.infer<typeof createPlannedStopSchema>
export type PatchPlannedStopBody = z.infer<typeof patchPlannedStopSchema>
export type ClosePlannedStopBody = z.infer<typeof closePlannedStopSchema>
export type StartPlannedStopBody = z.infer<typeof startPlannedStopSchema>
