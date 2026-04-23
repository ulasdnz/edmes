import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

export const jobOrderRecordsBatchSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            jobOrderId: objectIdSchema,
            from: utcDateSchema,
            to: utcDateSchema,
          })
          .strict()
          .refine(
            v =>
              !(v.from instanceof Date) ||
              !(v.to instanceof Date) ||
              v.from.getTime() <= v.to.getTime(),
            { message: 'error.invalid_range', path: ['from'] },
          ),
      )
      .min(1)
      .max(500),
    include: z.array(z.enum(['quantity_adjustments', 'scrap_entries'])).min(1),
  })
  .strict()

export type JobOrderRecordsBatchInput = z.infer<typeof jobOrderRecordsBatchSchema>
