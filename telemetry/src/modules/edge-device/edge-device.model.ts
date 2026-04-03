import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const edgeDeviceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    deviceKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      immutable: true,
    },
    desc: {
      type: String,
      default: null,
    },
    ipAddress: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'unknown'],
      default: 'unknown',
    },
  },
  {
    timestamps: true,
    strict: true,
    toObject: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        delete ret.__v
        return ret
      },
    },
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        delete ret.__v
        return ret
      },
    },
  },
)

export type IEdgeDevice = InferSchemaType<typeof edgeDeviceSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

edgeDeviceSchema.plugin(auditLogPlugin)

const EdgeDevice = model<IEdgeDevice>('EdgeDevice', edgeDeviceSchema)
export default EdgeDevice
