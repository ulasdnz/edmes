import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const operatorCheckInSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true, index: true },
    operatorId: { type: Schema.Types.ObjectId, required: true },
    checkedInAt: { type: Date, required: true, default: () => new Date() },
    checkedOutAt: { type: Date, default: null },
    shiftId: { type: Schema.Types.ObjectId, default: null },
    checkoutSource: {
      type: String,
      enum: ['manual', 'shift_boundary'],
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, strict: true },
)

// Partial unique index: only one active (checkedOutAt: null) check-in per operator per work center
operatorCheckInSchema.index(
  { workCenterId: 1, operatorId: 1 },
  { unique: true, partialFilterExpression: { checkedOutAt: null } },
)

operatorCheckInSchema.set('toObject', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
operatorCheckInSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IOperatorCheckIn = InferSchemaType<typeof operatorCheckInSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

operatorCheckInSchema.plugin(auditLogPlugin)

export const OperatorCheckIn = model<IOperatorCheckIn>('OperatorCheckIn', operatorCheckInSchema)
