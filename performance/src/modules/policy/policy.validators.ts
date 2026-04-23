import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'
import { ACTUAL_OUTPUT_WINDOW_MODES, PRODUCTIVITY_AGGREGATION_MODES } from './policy.model.js'

export const policyUpdateSchema = z
  .object({
    runModeDebounceMs: z.number().int().min(0).optional(),
    microStopThresholdMs: z.number().int().min(0).optional(),
    actualOutputWindowMode: z.enum(ACTUAL_OUTPUT_WINDOW_MODES).optional(),
    productivityAggregationMode: z.enum(PRODUCTIVITY_AGGREGATION_MODES).optional(),
    allowProductivityOver100: z.boolean().optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const workCenterIdParamSchema = z.object({ workCenterId: objectIdSchema })

export type PolicyUpdateInput = z.infer<typeof policyUpdateSchema>
