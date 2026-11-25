import { PRIVILEGES } from '@mes/privileges'
import bcrypt from 'bcryptjs'
import { config } from '../../config/index.js'
import {
  SYSTEM_ADMIN_DEV_PASSWORD,
  SYSTEM_ADMIN_NAME,
  SYSTEM_ADMIN_ROLE_DESCRIPTION,
  SYSTEM_ADMIN_ROLE_NAME,
  SYSTEM_ADMIN_SURNAME,
  SYSTEM_ADMIN_USERNAME,
} from '../../constants/system-admin.js'
import {
  emitRoleCreated,
  emitRoleUpdated,
  emitUserCreated,
  emitUserUpdated,
} from '../../jobs/events.js'
import { logger } from '../../lib/logger.js'
import Role, { type IRole } from '../../modules/role/role.model.js'
import User from '../../modules/user/user.model.js'

const sameStringSet = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false

  const leftSet = new Set(left)
  return right.every(value => leftSet.has(value))
}

export const isSystemAdminByUsername = (username: string): boolean =>
  config.SYSTEM_ADMIN_BOOTSTRAP_ENABLED && username === SYSTEM_ADMIN_USERNAME

const ensureSystemAdminRole = async (permissions: string[]): Promise<IRole> => {
  const existingRole = await Role.findOne({ name: SYSTEM_ADMIN_ROLE_NAME })

  if (!existingRole) {
    const role = await Role.create({
      name: SYSTEM_ADMIN_ROLE_NAME,
      description: SYSTEM_ADMIN_ROLE_DESCRIPTION,
      permissions,
    })

    await emitRoleCreated(role._id.toString())

    logger.info('System admin role bootstrapped', {
      event: 'bootstrap.system_admin.role_created',
      roleId: role._id.toString(),
      roleName: SYSTEM_ADMIN_ROLE_NAME,
    })

    return role
  }

  const nextPermissions = [...permissions]
  const shouldUpdate =
    !sameStringSet((existingRole.permissions ?? []) as string[], nextPermissions) ||
    existingRole.description !== SYSTEM_ADMIN_ROLE_DESCRIPTION

  if (!shouldUpdate) {
    return existingRole
  }

  const role = await Role.findOneAndUpdate(
    { _id: existingRole._id },
    {
      $set: {
        description: SYSTEM_ADMIN_ROLE_DESCRIPTION,
        permissions: nextPermissions,
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
    roleName: SYSTEM_ADMIN_ROLE_NAME,
  })

  return role
}

const ensureSystemAdminUser = async (roleId: string): Promise<void> => {
  const existingUser = await User.findOne({ username: SYSTEM_ADMIN_USERNAME })

  if (!existingUser) {
    const password = config.SYSTEM_ADMIN_PASSWORD ?? SYSTEM_ADMIN_DEV_PASSWORD
    const hashedPassword = await bcrypt.hash(password, 10)
    // A password someone chose stays; the default one and a generated one are replaced at first
    // sign-in, since both were shown or are known
    const mustChangePassword =
      !config.SYSTEM_ADMIN_PASSWORD || config.SYSTEM_ADMIN_MUST_CHANGE_PASSWORD

    const user = await User.create({
      username: SYSTEM_ADMIN_USERNAME,
      email: config.SYSTEM_ADMIN_EMAIL.trim().toLowerCase(),
      name: SYSTEM_ADMIN_NAME,
      surname: SYSTEM_ADMIN_SURNAME,
      password: hashedPassword,
      roles: [roleId],
      isActivated: true,
      mustChangePassword,
    })

    await emitUserCreated(user._id.toString())

    logger.info('System admin user bootstrapped', {
      event: 'bootstrap.system_admin.user_created',
      userId: user._id.toString(),
      username: SYSTEM_ADMIN_USERNAME,
      mustChangePassword,
    })

    return
  }

  const currentRoles = (existingUser.roles ?? []).map(String)
  const hasSystemRole = currentRoles.includes(roleId)

  const shouldUpdate = !hasSystemRole || existingUser.isActivated !== true

  if (!shouldUpdate) {
    return
  }

  const nextRoles = hasSystemRole ? currentRoles : [...currentRoles, roleId]

  const user = await User.findOneAndUpdate(
    { _id: existingUser._id },
    {
      $set: {
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
    username: SYSTEM_ADMIN_USERNAME,
    syncedFields: {
      roleAdded: !hasSystemRole,
      reactivated: existingUser.isActivated !== true,
    },
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
    roleName: SYSTEM_ADMIN_ROLE_NAME,
    username: SYSTEM_ADMIN_USERNAME,
    permissionCount: permissions.length,
  })
}
