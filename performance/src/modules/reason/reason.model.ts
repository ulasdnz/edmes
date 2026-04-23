import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

export const REASON_USAGES = ['planned_stop', 'unplanned_stop', 'scrap'] as const
export type ReasonUsage = (typeof REASON_USAGES)[number]

const reasonSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: null, trim: true },
    usages: {
      type: [{ type: String, enum: REASON_USAGES }],
      default: [],
    },
    affectsOee: { type: Boolean, default: true },
    isSystemDefault: { type: Boolean, default: false },
    workCenterIds: { type: [Schema.Types.ObjectId], default: [] },
    canStartManually: { type: Boolean, default: true },
    canBeScheduled: { type: Boolean, default: true },
    canConvertFromUnplanned: { type: Boolean, default: true },
    requiresDescription: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    props: { type: Map, of: Schema.Types.Mixed, default: undefined },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

reasonSchema.index({ usages: 1, affectsOee: 1 })
reasonSchema.index({ isActive: 1 })

reasonSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
reasonSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IReason = InferSchemaType<typeof reasonSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

reasonSchema.plugin(auditLogPlugin)

export const Reason = model<IReason>('Reason', reasonSchema)
