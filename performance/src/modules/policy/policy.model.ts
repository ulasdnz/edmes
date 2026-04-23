import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

export const ACTUAL_OUTPUT_WINDOW_MODES = ['execution_span', 'net_run_segments'] as const
export type ActualOutputWindowMode = (typeof ACTUAL_OUTPUT_WINDOW_MODES)[number]

export const PRODUCTIVITY_AGGREGATION_MODES = ['total_ratio', 'run_time_weighted_ratio'] as const
export type ProductivityAggregationMode = (typeof PRODUCTIVITY_AGGREGATION_MODES)[number]

const policySchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, default: null, unique: true },
    runModeDebounceMs: { type: Number, default: 0, min: 0 },
    microStopThresholdMs: { type: Number, default: 120_000, min: 0 },
    actualOutputWindowMode: {
      type: String,
      enum: ACTUAL_OUTPUT_WINDOW_MODES,
      default: 'execution_span',
    },
    productivityAggregationMode: {
      type: String,
      enum: PRODUCTIVITY_AGGREGATION_MODES,
      default: 'total_ratio',
    },
    allowProductivityOver100: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

policySchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
policySchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IPerformanceRuntimePolicy = InferSchemaType<typeof policySchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

policySchema.plugin(auditLogPlugin)

export const PerformanceRuntimePolicy = model<IPerformanceRuntimePolicy>(
  'PerformanceRuntimePolicy',
  policySchema,
)
