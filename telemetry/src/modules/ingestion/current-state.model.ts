import mongoose, { type InferSchemaType } from 'mongoose'

const { Schema, model } = mongoose

const currentStateSchema = new Schema(
  {
    tagId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: Number,
      required: true,
    },
    occurredAt: {
      type: Date,
      required: true,
    },
    updatedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  {
    collection: 'current_states',
    strict: true,
  },
)

export type ICurrentState = InferSchemaType<typeof currentStateSchema>

const CurrentState = model<ICurrentState>('CurrentState', currentStateSchema)
export default CurrentState
