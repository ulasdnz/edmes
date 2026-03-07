import mongoose, { type Document, type Model, Schema } from 'mongoose'

export interface IPasswordRecovery extends Document {
  userId: mongoose.Types.ObjectId
  codeHash: string
  expiredAt: Date
  isUsed: boolean
  createdAt: Date
  updatedAt: Date
}

const passwordRecoverySchema = new Schema<IPasswordRecovery>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    expiredAt: {
      type: Date,
      required: true,
    },
    isUsed: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    timestamps: true,
  },
)

// Auto-delete expired tokens (Mongo TTL index)
passwordRecoverySchema.index({ expiredAt: 1 }, { expireAfterSeconds: 0 })

// Query optimization for active token lookups
passwordRecoverySchema.index({ userId: 1, isUsed: 1, expiredAt: 1 })

const PasswordRecovery: Model<IPasswordRecovery> = mongoose.model<IPasswordRecovery>(
  'PasswordRecovery',
  passwordRecoverySchema,
  'password_recoveries',
)

export default PasswordRecovery
