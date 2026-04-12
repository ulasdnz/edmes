import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

// ── Weekly pattern sub-schema (shiftIds per day) ────────────────────────────

const weeklyPatternSchema = new Schema(
  {
    monday: { type: [Schema.Types.ObjectId], default: [] },
    tuesday: { type: [Schema.Types.ObjectId], default: [] },
    wednesday: { type: [Schema.Types.ObjectId], default: [] },
    thursday: { type: [Schema.Types.ObjectId], default: [] },
    friday: { type: [Schema.Types.ObjectId], default: [] },
    saturday: { type: [Schema.Types.ObjectId], default: [] },
    sunday: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
)

// ── WorkCenterCalendar ──────────────────────────────────────────────────────

const calendarSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true, index: true },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    status: { type: String, enum: ['active', 'retired'], default: 'active' },
    weeklyPattern: { type: weeklyPatternSchema, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, strict: true },
)

calendarSchema.index({ workCenterId: 1, status: 1 })
calendarSchema.set('toObject', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
calendarSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type ICalendar = InferSchemaType<typeof calendarSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

calendarSchema.plugin(auditLogPlugin)

export const Calendar = model<ICalendar>('WorkCenterCalendar', calendarSchema)

// ── DateException ───────────────────────────────────────────────────────────

const dateExceptionSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    // Date-only (YYYY-MM-DD), plant-local. NOT an instant.
    localDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    shiftIds: { type: [Schema.Types.ObjectId], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, strict: true },
)

dateExceptionSchema.index({ workCenterId: 1, localDate: 1 }, { unique: true })
dateExceptionSchema.set('toObject', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
dateExceptionSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IDateException = InferSchemaType<typeof dateExceptionSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

dateExceptionSchema.plugin(auditLogPlugin)

export const DateException = model<IDateException>('DateException', dateExceptionSchema)
