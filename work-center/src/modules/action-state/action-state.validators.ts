import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

export const ingestActionStateSchema = z.object({
  activeActions: z.array(z.enum(['downtime', 'operator', 'jobOrder', 'service'])).default([]),
})

export const actionStateParamSchema = z.object({
  workCenterId: objectIdSchema,
})

export type IngestActionStateInput = z.infer<typeof ingestActionStateSchema>
