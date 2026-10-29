import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

export const jobOrderWindowsQuerySchema = z
  .object({
    workCenterId: objectIdSchema,
    from: utcDateSchema,
    to: utcDateSchema,
  })
  .strict()
  .refine(v => v.to > v.from, { message: 'error.invalid_range', path: ['to'] })

export type JobOrderWindowsQuery = z.infer<typeof jobOrderWindowsQuerySchema>
