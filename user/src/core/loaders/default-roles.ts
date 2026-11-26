import { DEFAULT_ROLES, type DefaultRole } from '../../constants/default-roles.js'
import { emitRoleCreated, emitRoleUpdated } from '../../jobs/events.js'
import { logger } from '../../lib/logger.js'
import Role from '../../modules/role/role.model.js'

const createDefaultRole = async (definition: DefaultRole): Promise<void> => {
  const role = await Role.create({
    key: definition.key,
    name: definition.name,
    description: definition.description,
    permissions: [...definition.permissions],
    defaultPermissions: [...definition.permissions],
  })

  await emitRoleCreated(role._id.toString())

  logger.info('Default role bootstrapped', {
    event: 'bootstrap.default_roles.created',
    roleId: role._id.toString(),
    roleKey: definition.key,
  })
}

const syncDefaultRole = async (definition: DefaultRole): Promise<void> => {
  const existingRole = await Role.findOne({ key: definition.key })
  if (!existingRole) return

  const previous = new Set<string>(existingRole.defaultPermissions ?? [])
  const added = definition.permissions.filter(code => !previous.has(code))
  const current = new Set<string>(definition.permissions)
  if (added.length === 0 && previous.size === current.size) return

  const role = await Role.findOneAndUpdate(
    { _id: existingRole._id },
    {
      $addToSet: { permissions: { $each: added } },
      $set: { defaultPermissions: [...definition.permissions] },
    },
    { returnDocument: 'after', runValidators: true },
  )

  if (!role) return

  await emitRoleUpdated(role._id.toString())

  logger.info('Default role synchronized', {
    event: 'bootstrap.default_roles.synced',
    roleId: role._id.toString(),
    roleKey: definition.key,
    addedPermissions: added,
  })
}

export const ensureDefaultRoles = async (options: { firstInstall: boolean }): Promise<void> => {
  for (const definition of DEFAULT_ROLES) {
    if (options.firstInstall && !(await Role.exists({ key: definition.key }))) {
      await createDefaultRole(definition)
      continue
    }
    await syncDefaultRole(definition)
  }

  logger.info('Default roles bootstrap completed', {
    event: 'bootstrap.default_roles.completed',
    firstInstall: options.firstInstall,
  })
}
