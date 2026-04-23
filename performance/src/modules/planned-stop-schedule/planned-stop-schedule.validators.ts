import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'
import {
  DAYS_OF_WEEK,
  OCCURRENCE_START_MODES,
  RECURRENCE_FREQUENCIES,
} from './planned-stop-schedule.model.js'

const nameSchema = z.string().trim().min(1).max(128)
const descriptionSchema = z.string().trim().max(1000)
const propsSchema = z.record(z.string(), z.unknown())

const recurrenceSchema = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    daysOfWeek: z.array(z.enum(DAYS_OF_WEEK)).min(1).optional(),
    timezone: z.string().trim().min(1),
    startHour: z.number().int().min(0).max(23),
    startMinute: z.number().int().min(0).max(59),
  })
  .strict()

export const createScheduleSchema = z
  .object({
    workCenterIds: z.array(objectIdSchema).optional(),
    reasonId: objectIdSchema,
    plannedOwnerId: objectIdSchema,
    name: nameSchema,
    description: descriptionSchema.nullable().optional(),
    occurrenceStartMode: z.enum(OCCURRENCE_START_MODES),
    recurrence: recurrenceSchema,
    plannedDurationMs: z.number().int().min(1),
    createBeforeStartMs: z.number().int().min(0).optional(),
    isEnabled: z.boolean().optional(),
    props: propsSchema.optional(),
  })
  .strict()

export const patchScheduleSchema = z
  .object({
    reasonId: objectIdSchema.optional(),
    plannedOwnerId: objectIdSchema.optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    occurrenceStartMode: z.enum(OCCURRENCE_START_MODES).optional(),
    recurrence: recurrenceSchema.optional(),
    plannedDurationMs: z.number().int().min(1).optional(),
    createBeforeStartMs: z.number().int().min(0).optional(),
    isEnabled: z.boolean().optional(),
    props: propsSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const scheduleIdParamSchema = z.object({ id: objectIdSchema })

export const scheduleListSchema = z.object({
  workCenterId: objectIdSchema.optional(),
  reasonId: objectIdSchema.optional(),
  isEnabled: z.coerce.boolean().optional(),
})
