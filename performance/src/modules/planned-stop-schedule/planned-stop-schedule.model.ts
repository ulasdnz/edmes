import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]

export const DAYS_OF_WEEK = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]

export const OCCURRENCE_START_MODES = ['automatic', 'manual'] as const
export type OccurrenceStartMode = (typeof OCCURRENCE_START_MODES)[number]

const recurrenceSchema = new Schema(
  {
    frequency: { type: String, enum: RECURRENCE_FREQUENCIES, required: true },
    daysOfWeek: { type: [{ type: String, enum: DAYS_OF_WEEK }], default: undefined },
    timezone: { type: String, required: true },
    startHour: { type: Number, required: true, min: 0, max: 23 },
    startMinute: { type: Number, required: true, min: 0, max: 59 },
  },
  { _id: false, strict: true },
)

const plannedStopScheduleSchema = new Schema(
  {
    workCenterIds: { type: [Schema.Types.ObjectId], default: [] },
    reasonId: { type: Schema.Types.ObjectId, required: true },
    plannedOwnerId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },
    occurrenceStartMode: { type: String, enum: OCCURRENCE_START_MODES, required: true },
    recurrence: { type: recurrenceSchema, required: true },
    plannedDurationMs: { type: Number, required: true, min: 1 },
    createBeforeStartMs: { type: Number, default: 15 * 60 * 1000, min: 0 },
    isEnabled: { type: Boolean, default: true },
    props: { type: Map, of: Schema.Types.Mixed, default: undefined },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

plannedStopScheduleSchema.index({ isEnabled: 1 })
plannedStopScheduleSchema.index({ workCenterIds: 1 })
plannedStopScheduleSchema.index({ reasonId: 1 })

plannedStopScheduleSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
plannedStopScheduleSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IPlannedStopSchedule = InferSchemaType<typeof plannedStopScheduleSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

plannedStopScheduleSchema.plugin(auditLogPlugin)

export const PlannedStopSchedule = model<IPlannedStopSchedule>(
  'PlannedStopSchedule',
  plannedStopScheduleSchema,
)
