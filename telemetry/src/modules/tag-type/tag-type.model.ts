import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const tagTypeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    desc: {
      type: String,
      default: null,
    },
    unit: {
      type: String,
      default: null,
      trim: true,
    },
    displayColor: {
      type: String,
      default: null,
      trim: true,
    },
    manualEntryMode: {
      type: String,
      enum: ['none', 'number', 'boolean'],
      default: 'none',
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

export type ITagType = InferSchemaType<typeof tagTypeSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

tagTypeSchema.plugin(auditLogPlugin)

const TagType = model<ITagType>('TagType', tagTypeSchema)
export default TagType
