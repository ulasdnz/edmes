import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const quantityAdjustmentSchema = new Schema(
  {
    jobOrderId: { type: Schema.Types.ObjectId, ref: 'JobOrder', required: true },
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, required: true },
    shiftId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true },
    time: { type: Date, required: true },
    reason: { type: String, default: null },
    description: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

quantityAdjustmentSchema.index({ jobOrderId: 1, time: 1 })
// Lists page newest first, within the caller's work centers or across all of them
quantityAdjustmentSchema.index({ workCenterId: 1, createdAt: -1, _id: -1 })
quantityAdjustmentSchema.index({ createdAt: -1, _id: -1 })

quantityAdjustmentSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
quantityAdjustmentSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IQuantityAdjustment = InferSchemaType<typeof quantityAdjustmentSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

quantityAdjustmentSchema.plugin(auditLogPlugin)

export const QuantityAdjustment = model<IQuantityAdjustment>(
  'QuantityAdjustment',
  quantityAdjustmentSchema,
)
