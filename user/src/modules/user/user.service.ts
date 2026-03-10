import type { AuthCacheScope } from '@mes/auth'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config } from '../../config/index.js'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import CustomError from '../../core/errors/index.js'
import { invalidateAuthCache } from '../../jobs/auth-cache.events.js'
import { logger } from '../../lib/logger.js'
import { type PaginationInput, type PaginationResult, paginate } from '../../utils/pagination.js'
import User, { type IUser } from './user.model.js'
import type { AuthResponse, UserResponse } from './user.types.js'
import type {
  AdminCreateUserInput,
  AdminResetPasswordInput,
  AdminUpdateUserInput,
  LoginInput,
  RegisterInput,
  UserQueryInput,
} from './user.validators.js'

const getCacheInvalidationScope = (flags: {
  status: boolean
  context: boolean
}): AuthCacheScope | null => {
  if (flags.status && flags.context) return 'all'
  if (flags.status) return 'status'
  if (flags.context) return 'context'
  return null
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const registerUser = async (data: RegisterInput): Promise<UserResponse> => {
  const existing = await User.findOne({ email: data.email })
  if (existing) {
    throw new CustomError(409, 'user.email_in_use')
  }

  const hashedPassword = await bcrypt.hash(data.password, 10)

  const user = await User.create({
    ...data,
    password: hashedPassword,
  })
  const { password: _password, ...response } = user.toObject()

  return response
}

export const loginUser = async (data: LoginInput): Promise<AuthResponse> => {
  const user = await User.findOne({ email: data.email }).select(
    '+password +failedLoginAttempts +lastFailedLoginAt',
  )
  if (!user) {
    throw new CustomError(401, 'auth.invalid_credentials')
  }

  // ── Login blocking check ─────────────────────────────────────────────────
  const { LOGIN_MAX_ATTEMPTS, LOGIN_BLOCKING_DURATION_MS } = config

  if (
    user.failedLoginAttempts >= LOGIN_MAX_ATTEMPTS &&
    user.lastFailedLoginAt &&
    Date.now() - new Date(user.lastFailedLoginAt).getTime() < LOGIN_BLOCKING_DURATION_MS
  ) {
    const remainingSec = Math.ceil(
      (LOGIN_BLOCKING_DURATION_MS - (Date.now() - new Date(user.lastFailedLoginAt).getTime())) /
        1000,
    )
    throw new CustomError(429, 'auth.account_temporarily_locked', {
      remainingSeconds: remainingSec,
    })
  }

  // ── Password comparison ──────────────────────────────────────────────────
  const isValid = await bcrypt.compare(data.password, user.password)

  if (!isValid) {
    await recordFailedLogin(
      user._id.toString(),
      user.failedLoginAttempts,
      user.lastFailedLoginAt ?? null,
    )
    throw new CustomError(401, 'auth.invalid_credentials')
  }

  // ── Successful login — reset counter ─────────────────────────────────────
  await resetFailedLogin(user._id.toString(), user.failedLoginAttempts)

  const token = jwt.sign(
    {
      id: user._id.toString(),
    },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  )

  const { password: _password, ...userResponse } = user.toObject()

  return {
    user: userResponse,
    token,
  }
}

// ─── Login blocking helpers ──────────────────────────────────────────────────

/**
 * Increment the failed login counter. If the blocking window has expired,
 * reset the counter to 1 (new window).
 */
const recordFailedLogin = async (
  userId: string,
  currentAttempts: number,
  lastFailedAt: Date | null,
): Promise<void> => {
  const { LOGIN_MAX_ATTEMPTS, LOGIN_BLOCKING_DURATION_MS } = config

  const windowExpired =
    currentAttempts >= LOGIN_MAX_ATTEMPTS &&
    lastFailedAt &&
    Date.now() - new Date(lastFailedAt).getTime() >= LOGIN_BLOCKING_DURATION_MS

  const newCount = windowExpired ? 1 : currentAttempts + 1

  await User.findByIdAndUpdate(userId, {
    $set: {
      failedLoginAttempts: newCount,
      lastFailedLoginAt: new Date(),
    },
  })

  logger.warn(`Failed login attempt ${newCount} for user ${userId}`)
}

/**
 * Reset the failed login counter on successful login.
 * Skips DB write if already clean (counter is 0).
 */
const resetFailedLogin = async (userId: string, currentAttempts: number): Promise<void> => {
  if (currentAttempts === 0) return

  await User.findByIdAndUpdate(userId, {
    $set: {
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
    },
  })
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const deleteUser = async (userId: string): Promise<void> => {
  const user = await User.findByIdAndDelete(userId)
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  await invalidateAuthCache(userId, 'all')
}

export const updateUser = async (userId: string, data: Partial<IUser>): Promise<UserResponse> => {
  const user = await User.findById(userId)
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  if (data.email && data.email !== user.email) {
    const existing = await User.findOne({ email: data.email })
    if (existing) {
      throw new CustomError(409, 'user.email_in_use')
    }
  }

  Object.assign(user, data)
  await user.save()

  const cacheScope = getCacheInvalidationScope({
    context: data.roles !== undefined,
    status: data.isActivated !== undefined,
  })

  if (cacheScope) {
    await invalidateAuthCache(userId, cacheScope)
  }

  return user
}

export const updateAvatar = async (
  userId: string,
  file: Express.Multer.File,
): Promise<UserResponse> => {
  const user = await User.findById(userId)
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  if (user.photoUrl && !user.photoUrl.includes('node.js_logo')) {
    const oldFilePath = user.photoUrl.replace('/uploads/', 'uploads/')
    try {
      const fs = await import('fs/promises')
      await fs.unlink(oldFilePath)
    } catch {
      logger.warn(`Failed to delete old avatar: ${oldFilePath}`)
    }
  }

  user.photoUrl = `/uploads/${file.filename}`
  await user.save()

  return user
}

export const getUser = async (userId: string): Promise<UserResponse> => {
  if (userId === SYSTEM_IDENTITY) {
    return {
      _id: SYSTEM_IDENTITY as any,
      username: 'system',
      email: 'system@internal',
      name: 'System',
      surname: 'Process',
      roles: [],
      isActivated: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any
  }

  const user = await User.findById(userId)
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  return user
}

export const getUsers = async (_query: UserQueryInput): Promise<UserResponse[]> => {
  const q = User.find()

  return q.exec()
}

export const findById = async (userId: string): Promise<UserResponse> => {
  if (userId === SYSTEM_IDENTITY) {
    return getUser(userId)
  }

  const user = await User.findById(userId)
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  return user
}

export const findByUsername = async (username: string): Promise<UserResponse> => {
  const user = await User.findOne({ username })
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }
  return user
}

export const findByEmail = async (email: string): Promise<UserResponse> => {
  const user = await User.findOne({ email })
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }
  return user
}

export const findByIdWithRoles = async (userId: string): Promise<UserResponse> => {
  const user = await User.findById(userId).populate({
    path: 'roleNames',
    select: 'id name description _id',
  })
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }
  return user
}

export const getUserRolesAndPermissions = async (
  userId: string,
): Promise<{ roles: string[]; permissions: string[] }> => {
  if (userId === SYSTEM_IDENTITY) {
    return { roles: [], permissions: ['*'] }
  }

  const user = await User.findById(userId).populate('roleNames', 'permissions').lean()

  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  const roles = user.roles ? user.roles.map(String) : []
  const roleDocs = (user as any).roleNames || []
  const permissions = [...new Set(roleDocs.flatMap((r: any) => r.permissions || []))] as string[]

  return { roles, permissions }
}

export const getUserAuthStatus = async (
  userId: string,
): Promise<{ isActivated: boolean; passwordChangedAt: string | null }> => {
  if (userId === SYSTEM_IDENTITY) {
    return { isActivated: true, passwordChangedAt: null }
  }

  const user = await User.findById(userId).select('+passwordChangedAt -_id isActivated').lean()

  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  return {
    isActivated: user.isActivated,
    passwordChangedAt: user.passwordChangedAt ? user.passwordChangedAt.toISOString() : null,
  }
}

export const getLanguages = (): string[] => {
  return ['tr', 'en']
}

export const getPropsKeys = async (): Promise<string[]> => {
  const result = await User.aggregate([
    { $project: { propKeys: { $objectToArray: '$props' } } },
    { $unwind: '$propKeys' },
    { $group: { _id: null, keys: { $addToSet: '$propKeys.k' } } },
  ])

  return result[0]?.keys || []
}

export const paginateUsers = async (input: PaginationInput): Promise<PaginationResult<IUser>> => {
  return paginate(User, input, {
    select: '-password -failedLoginAttempts -lastFailedLoginAt',
    populate: [{ path: 'roleNames', select: 'id name description _id' }],
  })
}

// ─── Internal Dependency Checks ────────────────────────────────────────────────

export const checkUserDependencies = async (
  fieldName: 'departmentId' | 'stationIds',
  fieldValue: string,
): Promise<boolean> => {
  const count = await User.countDocuments({ [fieldName]: fieldValue })
  return count > 0
}

export const adminCreateUser = async (data: AdminCreateUserInput): Promise<UserResponse> => {
  const existing = await User.findOne({ email: data.email })
  if (existing) {
    throw new CustomError(409, 'user.email_in_use')
  }

  const hashedPassword = await bcrypt.hash(data.password, 10)

  const user = await User.create({
    ...data,
    password: hashedPassword,
  })
  const { password: _password, ...response } = user.toObject()

  return response
}

export const adminUpdateUser = async (
  userId: string,
  data: AdminUpdateUserInput,
): Promise<UserResponse> => {
  const user = await User.findById(userId)
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  if (data.email && data.email !== user.email) {
    const existing = await User.findOne({ email: data.email })
    if (existing) {
      throw new CustomError(409, 'user.email_in_use')
    }
  }

  Object.assign(user, data)
  await user.save()

  const cacheScope = getCacheInvalidationScope({
    context: data.roles !== undefined,
    status: data.isActivated !== undefined,
  })

  if (cacheScope) {
    await invalidateAuthCache(userId, cacheScope)
  }

  return user
}

export const adminResetPassword = async (
  userId: string,
  data: AdminResetPasswordInput,
): Promise<void> => {
  const user = await User.findById(userId)
  if (!user) {
    throw new CustomError(404, 'user.not_found')
  }

  const hashedPassword = await bcrypt.hash(data.password, 10)

  user.password = hashedPassword
  user.passwordChangedAt = new Date()

  // Also reset any active blocking since password is manually reset by admin
  user.failedLoginAttempts = 0
  user.lastFailedLoginAt = null

  await user.save()

  await invalidateAuthCache(userId, 'status')
}
