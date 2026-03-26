import { z } from 'zod'
import { paginationSchema } from '../../utils/pagination.js'
import { objectIdSchema } from '../../utils/validators.js'

export const createScrapEntrySchema = z.object({
  jobOrderId: objectIdSchema,
  shiftId: objectIdSchema,
  amount: z.number().positive(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  causeId: objectIdSchema.nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  props: z.record(z.string(), z.string()).optional(),
})

export const patchScrapEntrySchema = z
  .object({
    shiftId: objectIdSchema.optional(),
    amount: z.number().positive().optional(),
    startTime: z.coerce.date().optional(),
    endTime: z.coerce.date().optional(),
    causeId: objectIdSchema.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    props: z.record(z.string(), z.string()).optional(),
  })
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const scrapEntryIdParamSchema = z.object({ id: objectIdSchema })

export const scrapEntryListSchema = paginationSchema.extend({
  _id: objectIdSchema.optional(),
  jobOrderId: objectIdSchema.optional(),
  workCenterId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  shiftId: objectIdSchema.optional(),
  causeId: objectIdSchema.optional(),
  createdBy: objectIdSchema.optional(),
  startTimeFrom: z.coerce.date().optional(),
  startTimeTo: z.coerce.date().optional(),
  endTimeFrom: z.coerce.date().optional(),
  endTimeTo: z.coerce.date().optional(),
  createdAtFrom: z.coerce.date().optional(),
  createdAtTo: z.coerce.date().optional(),
})

export type CreateScrapEntryInput = z.infer<typeof createScrapEntrySchema>
export type PatchScrapEntryInput = z.infer<typeof patchScrapEntrySchema>
export type ScrapEntryListInput = z.infer<typeof scrapEntryListSchema>
