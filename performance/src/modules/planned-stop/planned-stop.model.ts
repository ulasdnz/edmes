import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

export const PLANNED_STOP_SOURCES = ['manual', 'scheduled', 'converted', 'template'] as const
export type PlannedStopSource = (typeof PLANNED_STOP_SOURCES)[number]

export const PLANNED_STOP_START_MODES = ['automatic', 'manual'] as const
export type PlannedStopStartMode = (typeof PLANNED_STOP_START_MODES)[number]

export const PLANNED_STOP_STATUSES = ['planned', 'active', 'closed', 'cancelled'] as const
export type PlannedStopStatus = (typeof PLANNED_STOP_STATUSES)[number]

const plannedStopSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    reasonId: { type: Schema.Types.ObjectId, required: true },
    plannedOwnerId: { type: Schema.Types.ObjectId, required: true },
    source: { type: String, enum: PLANNED_STOP_SOURCES, required: true },
    startMode: { type: String, enum: PLANNED_STOP_START_MODES, required: true },
    status: {
      type: String,
      enum: PLANNED_STOP_STATUSES,
      required: true,
      default: 'planned',
    },
    plannedStartAt: { type: Date, required: true },
    plannedEndAt: { type: Date, required: true },
    actualStartAt: { type: Date, default: null },
    actualEndAt: { type: Date, default: null },
    scheduleId: { type: Schema.Types.ObjectId, default: null },
    templateId: { type: Schema.Types.ObjectId, default: null },
    operatorId: { type: Schema.Types.ObjectId, default: null },
    closedBy: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, default: null, trim: true },
    props: { type: Map, of: Schema.Types.Mixed, default: undefined },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

plannedStopSchema.index({ workCenterId: 1, plannedStartAt: 1, plannedEndAt: 1 })
plannedStopSchema.index(
  { workCenterId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
)
plannedStopSchema.index(
  { scheduleId: 1, workCenterId: 1, plannedStartAt: 1 },
  {
    unique: true,
    partialFilterExpression: { source: 'scheduled', scheduleId: { $exists: true } },
  },
)
plannedStopSchema.index({ reasonId: 1 })
// Lists page newest first, within the caller's work centers or across all of them
plannedStopSchema.index({ workCenterId: 1, createdAt: -1, _id: -1 })
plannedStopSchema.index({ createdAt: -1, _id: -1 })

plannedStopSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
plannedStopSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IPlannedStop = InferSchemaType<typeof plannedStopSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

plannedStopSchema.plugin(auditLogPlugin)

export const PlannedStop = model<IPlannedStop>('PlannedStop', plannedStopSchema)
