import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const roleSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: null,
    },
    permissions: {
      type: [String],
      default: [],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    strict: true,
  },
)

export type IRole = InferSchemaType<typeof roleSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

roleSchema.plugin(auditLogPlugin)

const Role = model<IRole>('Role', roleSchema)
export default Role
