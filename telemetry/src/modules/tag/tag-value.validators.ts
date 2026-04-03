import { z } from 'zod'

export const writeValueSchema = z
  .object({
    time: z.string().datetime(),
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
