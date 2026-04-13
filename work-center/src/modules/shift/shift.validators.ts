import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const timeFields = {
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
}

const sameTimeCheck = (d: {
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}) => !(d.startHour === d.endHour && d.startMinute === d.endMinute)

export const createShiftSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    ...timeFields,
  })
  .strict()
  .refine(sameTimeCheck, { message: 'shift.start_equals_end', path: ['endHour'] })

export const patchShiftSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    startHour: timeFields.startHour.optional(),
    startMinute: timeFields.startMinute.optional(),
    endHour: timeFields.endHour.optional(),
    endMinute: timeFields.endMinute.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const shiftIdParamSchema = z.object({
  id: objectIdSchema,
})

export type CreateShiftInput = z.infer<typeof createShiftSchema>
export type PatchShiftInput = z.infer<typeof patchShiftSchema>
