import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import { regexes } from 'zod'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: regexes.email,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    surname: {
      type: String,
      required: true,
      trim: true,
    },
    roles: {
      type: [Schema.Types.ObjectId],
      default: [],
      index: true,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },
    countryCode: {
      type: String,
    },
    birthDate: {
      type: Date,
    },
    photoUrl: {
      type: String,
      default: null,
    },
    language: {
      type: String,
      enum: ['en', 'tr'],
      default: 'en',
    },

    personalNumber: {
      type: String,
      default: null,
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    stationIds: {
      type: [Schema.Types.ObjectId],
      default: [],
      index: true,
    },
    specialities: {
      type: [Schema.Types.ObjectId],
      default: [],
    },
    defaultDashboardId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    // Extensible key-value metadata (typed: string → string)
    props: {
      type: Map,
      of: String,
      default: () => new Map(),
    },

    // Account status & security
    isActivated: {
      type: Boolean,
      default: true,
    },
    isActiveDirectoryUser: {
      type: Boolean,
      default: false,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lastFailedLoginAt: {
      type: Date,
      default: null,
      select: false,
    },
    passwordChangedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    strict: true,
  },
)

userSchema.virtual('roleNames', {
  ref: 'Role',
  localField: 'roles',
  foreignField: '_id',
})

userSchema.set('toObject', { virtuals: true })
userSchema.set('toJSON', { virtuals: true })

export type IUser = InferSchemaType<typeof userSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

userSchema.plugin(auditLogPlugin)

const User = model<IUser>('User', userSchema)
export default User
