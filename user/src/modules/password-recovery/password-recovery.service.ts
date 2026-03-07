import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'
import CustomError from '../../core/errors/index.js'
import { emitAuthCacheInvalidation } from '../../jobs/auth-cache.events.js'
import { logger } from '../../lib/logger.js'
import User from '../user/user.model.js'
import PasswordRecovery from './password-recovery.model.js'
import type {
  RequestCodeInput,
  VerificationAndUpdateInput,
  VerificationCodeInput,
} from './password-recovery.validators.js'

const MAX_ATTEMPTS_PER_HOUR = 5
const RECOVERY_CODE_TTL_MS = 2 * 60 * 1000
const RECOVERY_LOOKUP_LIMIT = 5

const buildGenericRequestResult = (email: string) => ({
  email,
  expiredAt: new Date(Date.now() + RECOVERY_CODE_TTL_MS),
})

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  if (local.length < 2) return `***@${domain}`
  return `${local[0]}***${local[local.length - 1]}@${domain}`
}

const findActiveRecoveryByCode = async (userId: string, code: number) => {
  const activeRecoveries = await PasswordRecovery.find({
    userId,
    isUsed: false,
    expiredAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .limit(RECOVERY_LOOKUP_LIMIT)

  for (const recovery of activeRecoveries) {
    const isMatch = await bcrypt.compare(String(code), recovery.codeHash)
    if (isMatch) return recovery
  }

  return null
}

export const requestCode = async (data: RequestCodeInput) => {
  const normalizedEmail = data.email.toLowerCase()
  const user = await User.findOne({ email: normalizedEmail }).select('_id')

  // Uniform response: do not leak user existence.
  if (!user) {
    return buildGenericRequestResult(normalizedEmail)
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const recentRequestsCount = await PasswordRecovery.countDocuments({
    userId: user._id,
    createdAt: { $gte: oneHourAgo },
  })

  if (recentRequestsCount >= MAX_ATTEMPTS_PER_HOUR) {
    logger.warn(`Password recovery rate-limited for ${maskEmail(normalizedEmail)}`)
    return buildGenericRequestResult(normalizedEmail)
  }

  const code = String(randomInt(10000, 100000))
  const codeHash = await bcrypt.hash(code, 10)
  const expiredAt = new Date(Date.now() + RECOVERY_CODE_TTL_MS)

  const recovery = await PasswordRecovery.create({
    userId: user._id,
    codeHash,
    expiredAt,
    isUsed: false,
  })

  await PasswordRecovery.updateMany(
    { userId: user._id, _id: { $ne: recovery._id }, expiredAt: { $gt: new Date() } },
    { $set: { expiredAt: new Date() } },
  )

  logger.info(`Password recovery code generated for ${maskEmail(normalizedEmail)}`)

  return { email: normalizedEmail, expiredAt: recovery.expiredAt }
}

export const verifyCode = async (data: VerificationCodeInput) => {
  const normalizedEmail = data.email.toLowerCase()
  const user = await User.findOne({ email: normalizedEmail }).select('_id')
  if (!user) throw new CustomError(400, 'password_recovery.invalid_or_expired_code')

  const recovery = await findActiveRecoveryByCode(String(user._id), data.code)
  if (!recovery) {
    throw new CustomError(400, 'password_recovery.invalid_or_expired_code')
  }

  return { email: normalizedEmail, expiredAt: recovery.expiredAt }
}

export const verificationAndUpdate = async (data: VerificationAndUpdateInput) => {
  const normalizedEmail = data.email.toLowerCase()
  const user = await User.findOne({ email: normalizedEmail }).select('+password')
  if (!user) throw new CustomError(400, 'password_recovery.invalid_or_expired_code')

  const recovery = await findActiveRecoveryByCode(String(user._id), data.code)
  if (!recovery) {
    throw new CustomError(400, 'password_recovery.invalid_or_expired_code')
  }

  const hashedPassword = await bcrypt.hash(data.newPassword, 10)

  user.password = hashedPassword
  user.passwordChangedAt = new Date()
  user.failedLoginAttempts = 0
  user.lastFailedLoginAt = null
  await user.save()

  recovery.isUsed = true
  await recovery.save()

  await emitAuthCacheInvalidation(String(user._id), 'status')

  return { success: true }
}
