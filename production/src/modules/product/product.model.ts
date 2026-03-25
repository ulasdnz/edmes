import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const productSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ProductCategory', default: null, index: true },
    kind: { type: String, required: true, enum: ['finished', 'semi_finished'] },
    uomId: { type: Schema.Types.ObjectId, ref: 'Uom', required: true, index: true },
    props: { type: Map, of: String, default: () => new Map() },
  },
  { timestamps: true, strict: true },
)

productSchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
productSchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IProduct = InferSchemaType<typeof productSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

productSchema.plugin(auditLogPlugin)

export const Product = model<IProduct>('Product', productSchema)
