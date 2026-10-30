import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const jobOrderSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    productionPlanId: {
      type: Schema.Types.ObjectId,
      ref: 'ProductionPlan',
      default: null,
      index: true,
    },
    targetQuantity: { type: Number, required: true },
    plannedStartAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
    description: { type: String, default: null },
    props: { type: Map, of: String, default: () => new Map() },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
    startedBy: { type: Schema.Types.ObjectId, default: null },
    endedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

jobOrderSchema.index({ workCenterId: 1, startTime: 1, endTime: 1 })
jobOrderSchema.index({ productId: 1, workCenterId: 1 })
// Lists page newest first, within the caller's work centers or across all of them
jobOrderSchema.index({ workCenterId: 1, createdAt: -1, _id: -1 })
jobOrderSchema.index({ createdAt: -1, _id: -1 })
// Running job orders are a handful among years of ended ones
jobOrderSchema.index(
  { workCenterId: 1, createdAt: -1, _id: -1 },
  { name: 'workCenterId_1_createdAt_-1__id_-1_open', partialFilterExpression: { endTime: null } },
)

jobOrderSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
jobOrderSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IJobOrder = InferSchemaType<typeof jobOrderSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

jobOrderSchema.plugin(auditLogPlugin)

export const JobOrder = model<IJobOrder>('JobOrder', jobOrderSchema)
