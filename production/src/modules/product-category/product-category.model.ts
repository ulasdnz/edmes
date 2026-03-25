import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const productCategorySchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
  },
  { timestamps: true, strict: true },
)

productCategorySchema.set('toObject', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})
productCategorySchema.set('toJSON', {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.__v
    return ret
  },
})

export type IProductCategory = InferSchemaType<typeof productCategorySchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

productCategorySchema.plugin(auditLogPlugin)

export const ProductCategory = model<IProductCategory>('ProductCategory', productCategorySchema)
