import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const bindingSchema = new Schema(
  {
    deviceKey: { type: String, required: true },
    nodeId: { type: String, default: null },
  },
  { _id: false },
)

const tagSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    desc: {
      type: String,
      default: null,
    },
    tagTypeId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    behavior: {
      type: String,
      enum: ['counter', 'speed', 'binary'],
      required: true,
    },
    storageMode: {
      type: String,
      enum: ['history', 'stateOnly'],
      default: 'history',
    },
    digit: {
      type: Number,
      default: 1,
    },
    tolerance: {
      type: Number,
      default: 0,
    },
    min: {
      type: Number,
      default: null,
    },
    max: {
      type: Number,
      default: null,
    },
    writable: {
      type: Boolean,
      default: false,
    },
    showOnGraph: {
      type: Boolean,
      default: false,
    },
    retentionPolicy: {
      type: String,
      default: null,
    },
    binding: {
      type: bindingSchema,
      default: null,
    },
    props: {
      type: Schema.Types.Mixed,
      default: {},
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

export type ITag = InferSchemaType<typeof tagSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

tagSchema.plugin(auditLogPlugin)

const Tag = model<ITag>('Tag', tagSchema)
export default Tag
