import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

export const UNPLANNED_STOP_SOURCES = ['run_mode', 'manual'] as const
export type UnplannedStopSource = (typeof UNPLANNED_STOP_SOURCES)[number]

const unplannedStopSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    reasonId: { type: Schema.Types.ObjectId, default: null },
    source: { type: String, enum: UNPLANNED_STOP_SOURCES, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, default: null },
    convertedToPlannedStopId: { type: Schema.Types.ObjectId, default: null },
    operatorId: { type: Schema.Types.ObjectId, default: null },
    closedBy: { type: Schema.Types.ObjectId, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, default: null, trim: true },
    props: { type: Map, of: Schema.Types.Mixed, default: undefined },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

unplannedStopSchema.index(
  { workCenterId: 1 },
  { unique: true, partialFilterExpression: { endAt: null } },
)
// A run-mode stop is written once, however many writers reach for the same start
unplannedStopSchema.index(
  { workCenterId: 1, startAt: 1 },
  { unique: true, partialFilterExpression: { source: 'run_mode' } },
)
unplannedStopSchema.index({ workCenterId: 1, startAt: 1, endAt: 1 })
unplannedStopSchema.index({ reasonId: 1 })
// Lists page newest first, within the caller's work centers or across all of them
unplannedStopSchema.index({ workCenterId: 1, createdAt: -1, _id: -1 })
unplannedStopSchema.index({ createdAt: -1, _id: -1 })

unplannedStopSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
unplannedStopSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IUnplannedStop = InferSchemaType<typeof unplannedStopSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

unplannedStopSchema.plugin(auditLogPlugin)

export const UnplannedStop = model<IUnplannedStop>('UnplannedStop', unplannedStopSchema)
