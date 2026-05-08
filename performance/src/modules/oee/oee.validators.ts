import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

export const oeeQuerySchema = z
  .object({
    workCenterId: objectIdSchema,
    from: utcDateSchema,
    to: utcDateSchema,
  })
  .refine(v => v.to > v.from, {
    message: 'error.invalid_range',
    path: ['to'],
  })

export type OeeQuery = z.infer<typeof oeeQuerySchema>
