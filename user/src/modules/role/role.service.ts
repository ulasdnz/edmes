import CustomError from '../../core/errors/index.js'
import { invalidateAuthCacheMany } from '../../jobs/auth-cache.events.js'
import User from '../user/user.model.js'
import Role from './role.model.js'
import type { CreateRoleInput, UpdateRoleInput } from './role.validators.js'

export const createRole = async (data: CreateRoleInput) => {
  const existing = await Role.findOne({ name: data.name })
  if (existing) {
    throw new CustomError(409, 'role.name_in_use')
  }

  return Role.create(data)
}

export const getRoles = async () => Role.find().lean()

export const getRoleById = async (id: string) => {
  const role = await Role.findById(id).lean()
  if (!role) {
    throw new CustomError(404, 'role.not_found')
  }

  return role
}

export const updateRole = async (id: string, data: UpdateRoleInput) => {
  if (data.name) {
    const existing = await Role.findOne({ name: data.name, _id: { $ne: id } })
    if (existing) {
      throw new CustomError(409, 'role.name_in_use')
    }
  }

  const role = await Role.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true })
  if (!role) {
    throw new CustomError(404, 'role.not_found')
  }

  if (data.permissions !== undefined) {
    const affectedUsers = await User.find({ roles: id }).select('_id').lean()
    await invalidateAuthCacheMany(
      affectedUsers.map(user => String(user._id)),
      'context',
    )
  }

  return role
}

export const deleteRole = async (id: string) => {
  const role = await Role.findByIdAndDelete(id)
  if (!role) {
    throw new CustomError(404, 'role.not_found')
  }

  // Cascade deletion: remove this role from all users who have it
  const affectedUsers = await User.find({ roles: id }).select('_id').lean()

  if (affectedUsers.length > 0) {
    await User.updateMany({ roles: id }, { $pull: { roles: id } })

    await invalidateAuthCacheMany(
      affectedUsers.map(user => String(user._id)),
      'context',
    )
  }
}
