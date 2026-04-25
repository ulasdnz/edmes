import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const utcInstantSchema = z.string().refine(
  val => {
    if (!val.endsWith('Z')) return false
    const d = new Date(val)
    return !Number.isNaN(d.getTime())
  },
  { message: 'error.invalid_datetime' },
)

export const oeeQuerySchema = z
  .object({
    workCenterId: objectIdSchema,
    from: utcInstantSchema,
    to: utcInstantSchema,
  })
  .refine(v => new Date(v.to) > new Date(v.from), {
    message: 'error.invalid_range',
    path: ['to'],
  })

export type OeeQuery = z.infer<typeof oeeQuerySchema>
