import { utcDateSchema } from '@mes/core'
import { z } from 'zod'
import { paginationSchema } from '../../utils/pagination.js'
import { objectIdSchema } from '../../utils/validators.js'

export const createScrapEntrySchema = z
  .object({
    jobOrderId: objectIdSchema,
    shiftId: objectIdSchema,
    amount: z.number().positive(),
    startTime: utcDateSchema,
    endTime: utcDateSchema,
    reasonId: objectIdSchema.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export const patchScrapEntrySchema = z
  .object({
    shiftId: objectIdSchema.optional(),
    amount: z.number().positive().optional(),
    startTime: utcDateSchema.optional(),
    endTime: utcDateSchema.optional(),
    reasonId: objectIdSchema.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const scrapEntryIdParamSchema = z.object({ id: objectIdSchema })

export const scrapEntryListSchema = paginationSchema.extend({
  _id: objectIdSchema.optional(),
  jobOrderId: objectIdSchema.optional(),
  workCenterId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  shiftId: objectIdSchema.optional(),
  reasonId: objectIdSchema.optional(),
  createdBy: objectIdSchema.optional(),
  startTimeFrom: utcDateSchema.optional(),
  startTimeTo: utcDateSchema.optional(),
  endTimeFrom: utcDateSchema.optional(),
  endTimeTo: utcDateSchema.optional(),
  createdAtFrom: utcDateSchema.optional(),
  createdAtTo: utcDateSchema.optional(),
})

export type CreateScrapEntryInput = z.infer<typeof createScrapEntrySchema>
export type PatchScrapEntryInput = z.infer<typeof patchScrapEntrySchema>
export type ScrapEntryListInput = z.infer<typeof scrapEntryListSchema>
