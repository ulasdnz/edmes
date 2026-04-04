import { utcDateSchema } from '@mes/core'
import { z } from 'zod'

export const writeValueSchema = z
  .object({
    time: utcDateSchema,
    value: z.number(),
  })
  .strict()

export const writeCommandSchema = z
  .object({
    value: z.union([z.number(), z.boolean()]),
  })
  .strict()

export type WriteValueInput = z.infer<typeof writeValueSchema>
export type WriteCommandInput = z.infer<typeof writeCommandSchema>
