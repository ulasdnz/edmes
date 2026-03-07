import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const specialitySchema = new Schema(
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
  },
  {
    timestamps: true,
    strict: true,
  },
)

export type ISpeciality = InferSchemaType<typeof specialitySchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

specialitySchema.plugin(auditLogPlugin)

const Speciality = model<ISpeciality>('Speciality', specialitySchema)
export default Speciality
