import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const productStandardSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    workCenterId: { type: Schema.Types.ObjectId, required: true, index: true },
    validFrom: { type: Date, required: true },
    idealOutputPerMinute: { type: Number, required: true },
    counterMultiplier: { type: Number, default: null },
    idealSpeed: { type: Number, default: null },
    backdateReason: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

productStandardSchema.index({ productId: 1, workCenterId: 1, validFrom: 1 }, { unique: true })

productStandardSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
productStandardSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IProductStandard = InferSchemaType<typeof productStandardSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

productStandardSchema.plugin(auditLogPlugin)

export const ProductStandard = model<IProductStandard>('ProductStandard', productStandardSchema)
