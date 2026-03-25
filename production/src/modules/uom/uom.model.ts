import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const uomSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    symbol: { type: String, required: true, trim: true },
  },
  { timestamps: true, strict: true },
)

uomSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
uomSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IUom = InferSchemaType<typeof uomSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

uomSchema.plugin(auditLogPlugin)

export const Uom = model<IUom>('Uom', uomSchema)
