import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const shiftSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    startHour: { type: Number, required: true, min: 0, max: 23 },
    startMinute: { type: Number, required: true, min: 0, max: 59 },
    endHour: { type: Number, required: true, min: 0, max: 23 },
    endMinute: { type: Number, required: true, min: 0, max: 59 },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, strict: true },
)

shiftSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

shiftSchema.set('toObject', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
shiftSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IShift = InferSchemaType<typeof shiftSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

shiftSchema.plugin(auditLogPlugin)

export const Shift = model<IShift>('Shift', shiftSchema)
