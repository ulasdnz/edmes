import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

export const OVERRUN_POLICIES = [
  'split_to_unplanned',
  'extend_planned_until_close',
  'alert_only',
] as const
export type OverrunPolicy = (typeof OVERRUN_POLICIES)[number]

const plannedStopTemplateSchema = new Schema(
  {
    workCenterIds: { type: [Schema.Types.ObjectId], default: [] },
    reasonId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },
    defaultDurationMs: { type: Number, required: true, min: 1 },
    plannedOwnerId: { type: Schema.Types.ObjectId, default: null },
    responsibleUserId: { type: Schema.Types.ObjectId, default: null },
    overrunPolicy: { type: String, enum: OVERRUN_POLICIES, required: true },
    overrunReasonId: { type: Schema.Types.ObjectId, default: null },
    isActive: { type: Boolean, default: true },
    props: { type: Map, of: Schema.Types.Mixed, default: undefined },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

plannedStopTemplateSchema.index({ workCenterIds: 1, isActive: 1 })
plannedStopTemplateSchema.index({ reasonId: 1 })

plannedStopTemplateSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
plannedStopTemplateSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IPlannedStopTemplate = InferSchemaType<typeof plannedStopTemplateSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

plannedStopTemplateSchema.plugin(auditLogPlugin)

export const PlannedStopTemplate = model<IPlannedStopTemplate>(
  'PlannedStopTemplate',
  plannedStopTemplateSchema,
)
