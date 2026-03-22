import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { config } from '../../config/index.js'
import { PRIVILEGES } from '../../constants/privileges.js'
import {
  emitRoleCreated,
  emitRoleUpdated,
  emitUserCreated,
  emitUserUpdated,
} from '../../jobs/events.js'
import { logger } from '../../lib/logger.js'
import Role, { type IRole } from '../../modules/role/role.model.js'
import User, { type IUser } from '../../modules/user/user.model.js'

const SYSTEM_ROLE_DESCRIPTION = 'Bootstrapped full-access system administrator role'

const sameStringSet = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false

  const leftSet = new Set(left)
  return right.every(value => leftSet.has(value))
}

const generateBootstrapPassword = (): string => randomBytes(10).toString('hex')

const ensureSystemAdminRole = async (permissions: string[]): Promise<IRole> => {
  const roleName = config.SYSTEM_ADMIN_ROLE_NAME.trim()
  const existingRole = await Role.findOne({ name: roleName })

  if (!existingRole) {
    const role = await Role.create({
      name: roleName,
      description: SYSTEM_ROLE_DESCRIPTION,
      permissions,
      isDefault: false,
    })

    await emitRoleCreated(role._id.toString())

    logger.info('System admin role bootstrapped', {
      event: 'bootstrap.system_admin.role_created',
      roleId: role._id.toString(),
      roleName,
    })

    return role
  }

  const nextPermissions = [...permissions]
  const shouldUpdate =
    !sameStringSet(existingRole.permissions ?? [], nextPermissions) ||
    existingRole.description !== SYSTEM_ROLE_DESCRIPTION ||
    existingRole.isDefault !== false

  if (!shouldUpdate) {
    return existingRole
  }

  const role = await Role.findOneAndUpdate(
    { _id: existingRole._id },
    {
      $set: {
        description: SYSTEM_ROLE_DESCRIPTION,
        permissions: nextPermissions,
        isDefault: false,
      },
    },
    { returnDocument: 'after', runValidators: true },
  )

  if (!role) {
    throw new Error('System admin role disappeared during bootstrap')
  }

  await emitRoleUpdated(role._id.toString())

  logger.info('System admin role synchronized', {
    event: 'bootstrap.system_admin.role_synced',
    roleId: role._id.toString(),
    roleName,
  })

  return role
}

const ensureSingleSystemUserCandidate = async (
  email: string,
  username: string,
): Promise<IUser | null> => {
  const existingByEmail = await User.findOne({ email })
  const existingByUsername = await User.findOne({ username })

  if (
    existingByEmail &&
    existingByUsername &&
    existingByEmail._id.toString() !== existingByUsername._id.toString()
  ) {
    throw new Error(
      'SYSTEM_ADMIN_EMAIL and SYSTEM_ADMIN_USERNAME resolve to different existing users',
    )
  }

  return existingByEmail ?? existingByUsername ?? null
}

const ensureSystemAdminUser = async (roleId: string): Promise<void> => {
  const email = config.SYSTEM_ADMIN_EMAIL.trim().toLowerCase()
  const username = config.SYSTEM_ADMIN_USERNAME.trim().toLowerCase()
  const name = config.SYSTEM_ADMIN_NAME.trim()
  const surname = config.SYSTEM_ADMIN_SURNAME.trim()

  const existingUser = await ensureSingleSystemUserCandidate(email, username)

  if (!existingUser) {
    const password = config.SYSTEM_ADMIN_PASSWORD ?? generateBootstrapPassword()
    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await User.create({
      username,
      email,
      name,
      surname,
      password: hashedPassword,
      roles: [roleId],
      isActivated: true,
    })

    await emitUserCreated(user._id.toString())

    logger.info('System admin user bootstrapped', {
      event: 'bootstrap.system_admin.user_created',
      userId: user._id.toString(),
      username,
      email,
    })

    if (!config.SYSTEM_ADMIN_PASSWORD) {
      logger.warn(
        'System admin password was generated automatically. Rotate it after first login.',
        {
          event: 'bootstrap.system_admin.password_generated',
          email,
          username,
        },
      )
      process.stderr.write(`[BOOTSTRAP] System admin initial password: ${password}\n`)
    }

    return
  }

  const currentRoles = (existingUser.roles ?? []).map(String)
  const nextRoles = currentRoles.includes(roleId) ? currentRoles : [...currentRoles, roleId]

  const shouldUpdate =
    existingUser.username !== username ||
    existingUser.email !== email ||
    existingUser.name !== name ||
    existingUser.surname !== surname ||
    existingUser.isActivated !== true ||
    nextRoles.length !== currentRoles.length

  if (!shouldUpdate) {
    return
  }

  const user = await User.findOneAndUpdate(
    { _id: existingUser._id },
    {
      $set: {
        username,
        email,
        name,
        surname,
        isActivated: true,
        roles: nextRoles,
      },
    },
    { returnDocument: 'after', runValidators: true },
  )

  if (!user) {
    throw new Error('System admin user disappeared during bootstrap')
  }

  await emitUserUpdated(user._id.toString())

  logger.info('System admin user synchronized', {
    event: 'bootstrap.system_admin.user_synced',
    userId: user._id.toString(),
    username,
    email,
  })
}

export const ensureSystemAdmin = async (): Promise<void> => {
  if (!config.SYSTEM_ADMIN_BOOTSTRAP_ENABLED) {
    logger.info('System admin bootstrap disabled', {
      event: 'bootstrap.system_admin.disabled',
    })
    return
  }

  const permissions = PRIVILEGES.map(privilege => privilege.code)
  const role = await ensureSystemAdminRole(permissions)
  await ensureSystemAdminUser(role._id.toString())

  logger.info('System admin bootstrap completed', {
    event: 'bootstrap.system_admin.completed',
    roleName: config.SYSTEM_ADMIN_ROLE_NAME,
    username: config.SYSTEM_ADMIN_USERNAME,
    email: config.SYSTEM_ADMIN_EMAIL,
    permissionCount: permissions.length,
  })
}
