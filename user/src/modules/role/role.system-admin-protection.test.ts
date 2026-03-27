import { describe, expect, it } from 'vitest'
import { SYSTEM_ADMIN_ROLE_NAME } from '../../constants/system-admin.js'
import Role from './role.model.js'
import { deleteRole, updateRole } from './role.service.js'

const createSystemAdminRoleFixture = async () => {
  const role = await Role.create({
    name: SYSTEM_ADMIN_ROLE_NAME,
    description: 'Bootstrapped full-access system administrator role',
    permissions: ['readUsers', 'writeUsers', 'deleteUsers'],
  })
  return role
}

describe('system admin role protection', () => {
  it('rejects deletion of system admin role', async () => {
    const role = await createSystemAdminRoleFixture()

    await expect(deleteRole(role._id.toString())).rejects.toMatchObject({
      statusCode: 403,
      message: 'role.system_admin_protected',
    })
  })

  it('rejects renaming of system admin role', async () => {
    const role = await createSystemAdminRoleFixture()

    await expect(updateRole(role._id.toString(), { name: 'Super Admin' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'role.system_admin_rename_protected',
    })
  })

  it('rejects permission changes on system admin role', async () => {
    const role = await createSystemAdminRoleFixture()

    await expect(
      updateRole(role._id.toString(), { permissions: ['readUsers'] }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'role.system_admin_permissions_protected',
    })
  })

  it('allows updating description of system admin role', async () => {
    const role = await createSystemAdminRoleFixture()

    const updated = await updateRole(role._id.toString(), {
      description: 'Updated description',
    })

    expect(updated?.description).toBe('Updated description')
  })
})
