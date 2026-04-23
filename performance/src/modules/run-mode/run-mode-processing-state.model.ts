import mongoose, { type InferSchemaType, type Types } from 'mongoose'

const { Schema, model } = mongoose

const runModeProcessingStateSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    runModeTagId: { type: Schema.Types.ObjectId, required: true },
    lastProcessedOccurredAt: { type: Date, required: true },
    lastProcessedValue: { type: Number, required: true },
  },
  { timestamps: true, strict: true },
)

runModeProcessingStateSchema.index({ workCenterId: 1, runModeTagId: 1 }, { unique: true })

runModeProcessingStateSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
runModeProcessingStateSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IRunModeProcessingState = InferSchemaType<typeof runModeProcessingStateSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const RunModeProcessingState = model<IRunModeProcessingState>(
  'RunModeProcessingState',
  runModeProcessingStateSchema,
)
