import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

export const tagIdParamSchema = z.object({
  tagId: objectIdSchema,
})

export const rangeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
})

export const samplesQuerySchema = rangeQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  previous: z.enum(['true', 'false']).default('false'),
})

const INTERVAL_MAP: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '8h': 28_800_000,
  '1d': 86_400_000,
}

export const rollupQuerySchema = rangeQuerySchema.extend({
  interval: z.string().refine(val => val in INTERVAL_MAP, {
    message: 'validation.invalid_interval',
  }),
  fn: z.enum(['avg', 'min', 'max', 'sum', 'count']),
})

export const parseInterval = (interval: string): number => INTERVAL_MAP[interval]!

export type RangeQuery = z.infer<typeof rangeQuerySchema>
export type SamplesQuery = z.infer<typeof samplesQuerySchema>
export type RollupQuery = z.infer<typeof rollupQuerySchema>
