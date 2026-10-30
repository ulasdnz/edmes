import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const productionPlanSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    targetQuantity: { type: Number, required: true },
    dueAt: { type: Date, default: null },
    description: { type: String, default: null },
    props: { type: Map, of: String, default: () => new Map() },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

// Lists page newest first
productionPlanSchema.index({ createdAt: -1, _id: -1 })

productionPlanSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
productionPlanSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IProductionPlan = InferSchemaType<typeof productionPlanSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

productionPlanSchema.plugin(auditLogPlugin)

export const ProductionPlan = model<IProductionPlan>('ProductionPlan', productionPlanSchema)
