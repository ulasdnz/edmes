import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

export const checkInSchema = z.object({
  operatorId: objectIdSchema,
  shiftId: objectIdSchema.optional(),
})

export const operatorWorkCenterIdParamSchema = z.object({
  workCenterId: objectIdSchema,
})

export const checkInIdParamSchema = z.object({
  workCenterId: objectIdSchema,
  checkInId: objectIdSchema,
})

export type CheckInInput = z.infer<typeof checkInSchema>
