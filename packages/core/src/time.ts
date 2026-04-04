import { z } from 'zod'

export const UTC_ZONED_DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

export const isUtcZonedDateTimeString = (value: string): boolean => {
  if (!UTC_ZONED_DATETIME_REGEX.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

export const parseUtcZonedDateTime = (value: string): Date | null => {
  if (!isUtcZonedDateTimeString(value)) return null
  return new Date(value)
}

export const utcDateTimeStringSchema = z
  .string()
  .refine(isUtcZonedDateTimeString, { message: 'validation.datetime_utc_z_required' })

export const utcDateSchema = utcDateTimeStringSchema.transform(value => new Date(value))
