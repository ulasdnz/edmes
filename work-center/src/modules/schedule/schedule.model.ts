import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

// ── Shift sub-schema ────────────────────────────────────────────────────────

const shiftSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    startHour: { type: Number, required: true, min: 0, max: 23 },
    startMinute: { type: Number, required: true, min: 0, max: 59 },
    endHour: { type: Number, required: true, min: 0, max: 23 },
    endMinute: { type: Number, required: true, min: 0, max: 59 },
  },
  { _id: false },
)

// ── Weekly pattern sub-schema ───────────────────────────────────────────────

const weeklyPatternSchema = new Schema(
  {
    monday: { type: [shiftSchema], default: [] },
    tuesday: { type: [shiftSchema], default: [] },
    wednesday: { type: [shiftSchema], default: [] },
    thursday: { type: [shiftSchema], default: [] },
    friday: { type: [shiftSchema], default: [] },
    saturday: { type: [shiftSchema], default: [] },
    sunday: { type: [shiftSchema], default: [] },
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
    localDate: { type: Date, required: true },
    intervals: { type: [shiftSchema], default: [] },
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
