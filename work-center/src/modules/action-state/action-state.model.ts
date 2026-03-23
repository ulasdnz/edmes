import mongoose, { type InferSchemaType, type Types } from 'mongoose'

const { Schema, model } = mongoose

const actionStateSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true, index: true },
    changedAt: { type: Date, required: true },
    activeActions: {
      type: [{ type: String, enum: ['downtime', 'operator', 'jobOrder', 'service'] }],
      default: [],
    },
    createdBy: { type: String, required: true },
  },
  { timestamps: true, strict: true },
)

actionStateSchema.set('toObject', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
actionStateSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IActionState = InferSchemaType<typeof actionStateSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const ActionState = model<IActionState>('WorkCenterActionState', actionStateSchema)
