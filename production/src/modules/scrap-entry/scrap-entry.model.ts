import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const scrapEntrySchema = new Schema(
  {
    jobOrderId: { type: Schema.Types.ObjectId, ref: 'JobOrder', required: true },
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, required: true },
    shiftId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    reasonId: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, default: null },
    props: { type: Map, of: String, default: () => new Map() },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

scrapEntrySchema.index({ jobOrderId: 1, startTime: 1, endTime: 1 })
// Lists page newest first, within the caller's work centers or across all of them
scrapEntrySchema.index({ workCenterId: 1, createdAt: -1, _id: -1 })
scrapEntrySchema.index({ createdAt: -1, _id: -1 })

scrapEntrySchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
scrapEntrySchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IScrapEntry = InferSchemaType<typeof scrapEntrySchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

scrapEntrySchema.plugin(auditLogPlugin)

export const ScrapEntry = model<IScrapEntry>('ScrapEntry', scrapEntrySchema)
