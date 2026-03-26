import { SYSTEM_ADMIN_ROLE_NAME } from '../../constants/system-admin.js'
import CustomError from '../../core/errors/index.js'
import { invalidateAuthCacheMany } from '../../jobs/auth-cache.events.js'
import { emitRoleCreated, emitRoleDeleted, emitRoleUpdated } from '../../jobs/events.js'
import User from '../user/user.model.js'
import Role from './role.model.js'
import type { CreateRoleInput, UpdateRoleInput } from './role.validators.js'

export const createRole = async (data: CreateRoleInput) => {
  const existing = await Role.findOne({ name: data.name })
  if (existing) {
    throw new CustomError(409, 'role.name_in_use')
  }

  const role = await Role.create(data)

  await emitRoleCreated(role._id.toString())

  return role
}

export const getRoles = async () => Role.find().select('-__v').lean()

export const getRoleById = async (id: string) => {
  const role = await Role.findById(id).select('-__v').lean()
  if (!role) {
    throw new CustomError(404, 'role.not_found')
  }

  return role
}

export const updateRole = async (id: string, data: UpdateRoleInput) => {
  const currentRole = await Role.findById(id).lean()
  if (currentRole?.name === SYSTEM_ADMIN_ROLE_NAME) {
    if (data.name) {
      throw new CustomError(403, 'role.system_admin_rename_protected')
    }
    if (data.permissions !== undefined) {
      throw new CustomError(403, 'role.system_admin_permissions_protected')
    }
  }

  if (data.name) {
    const existing = await Role.findOne({ name: data.name, _id: { $ne: id } })
    if (existing) {
      throw new CustomError(409, 'role.name_in_use')
    }
  }

  const role = await Role.findByIdAndUpdate(
    id,
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  )
  if (!role) {
    throw new CustomError(404, 'role.not_found')
  }

  if (data.permissions !== undefined) {
    const affectedUsers = await User.find({ roles: id }).select('_id').lean()
    await invalidateAuthCacheMany(affectedUsers.map(user => String(user._id)))
  }

  await emitRoleUpdated(role._id.toString())

  return role
}

export const deleteRole = async (id: string) => {
  const target = await Role.findById(id).lean()
  if (!target) {
    throw new CustomError(404, 'role.not_found')
  }
  if (target.name === SYSTEM_ADMIN_ROLE_NAME) {
    throw new CustomError(403, 'role.system_admin_protected')
  }

  const role = await Role.findByIdAndDelete(id)
  if (!role) {
    throw new CustomError(404, 'role.not_found')
  }

  // Cascade deletion: remove this role from all users who have it
  const affectedUsers = await User.find({ roles: id }).select('_id').lean()

  if (affectedUsers.length > 0) {
    await User.updateMany({ roles: id }, { $pull: { roles: id } })

    await invalidateAuthCacheMany(affectedUsers.map(user => String(user._id)))
  }

  await emitRoleDeleted(id)
}
