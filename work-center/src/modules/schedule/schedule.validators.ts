import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

// ── Shift schema ────────────────────────────────────────────────────────────

const shiftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
}).strict()

// ── Weekly pattern ──────────────────────────────────────────────────────────

const weeklyPatternSchema = z.object({
  monday: z.array(shiftSchema).default([]),
  tuesday: z.array(shiftSchema).default([]),
  wednesday: z.array(shiftSchema).default([]),
  thursday: z.array(shiftSchema).default([]),
  friday: z.array(shiftSchema).default([]),
  saturday: z.array(shiftSchema).default([]),
  sunday: z.array(shiftSchema).default([]),
}).strict()

// ── Calendar schemas ────────────────────────────────────────────────────────

export const createCalendarSchema = z
  .object({
    validFrom: utcDateSchema,
    validTo: utcDateSchema,
    weeklyPattern: weeklyPatternSchema,
  })
  .strict()
  .refine(d => d.validFrom < d.validTo, {
    message: 'schedule.valid_from_before_valid_to',
    path: ['validTo'],
  })

export const replaceCalendarSchema = createCalendarSchema

export const patchCalendarSchema = z
  .object({
    validFrom: utcDateSchema.optional(),
    validTo: utcDateSchema.optional(),
    status: z.enum(['active', 'retired']).optional(),
    weeklyPattern: weeklyPatternSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, {
    message: 'error.empty_patch',
  })

// ── Date exception schemas ──────────────────────────────────────────────────

export const upsertExceptionSchema = z.object({
  intervals: z.array(shiftSchema).default([]),
}).strict()

// ── Param schemas ───────────────────────────────────────────────────────────

export const scheduleWorkCenterIdParamSchema = z.object({
  workCenterId: objectIdSchema,
})

export const calendarIdParamSchema = z.object({
  workCenterId: objectIdSchema,
  calendarId: objectIdSchema,
})

export const exceptionParamSchema = z.object({
  workCenterId: objectIdSchema,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'schedule.invalid_date_format'),
})

export const effectiveScheduleQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'schedule.invalid_date_format'),
})

// ── Type exports ────────────────────────────────────────────────────────────

export type CreateCalendarInput = z.infer<typeof createCalendarSchema>
export type PatchCalendarInput = z.infer<typeof patchCalendarSchema>
export type UpsertExceptionInput = z.infer<typeof upsertExceptionSchema>
