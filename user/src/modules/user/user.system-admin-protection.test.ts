import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { SYSTEM_ADMIN_ROLE_NAME, SYSTEM_ADMIN_USERNAME } from '../../constants/system-admin.js'
import Role from '../role/role.model.js'
import User from './user.model.js'
import { adminUpdateUser, deleteUser, updateUser } from './user.service.js'

const createSystemAdminFixture = async () => {
  const role = await Role.create({
    name: SYSTEM_ADMIN_ROLE_NAME,
    description: 'System admin role',
    permissions: ['readUsers', 'writeUsers'],
    isDefault: false,
  })

  const otherRole = await Role.create({
    name: 'Operator',
    description: 'Operator role',
    permissions: ['readUsers'],
    isDefault: false,
  })

  const user = await User.create({
    username: SYSTEM_ADMIN_USERNAME,
    email: 'system@factory.local',
    name: 'System',
    surname: 'Admin',
    password: await bcrypt.hash('Test123456', 10),
    roles: [role._id.toString()],
    isActivated: true,
  })

  return { role, otherRole, user }
}

describe('system admin user protection', () => {
  describe('deleteUser', () => {
    it('rejects deletion of system admin user', async () => {
      const { user } = await createSystemAdminFixture()

      await expect(deleteUser(user._id.toString())).rejects.toMatchObject({
        statusCode: 403,
        message: 'user.system_admin_protected',
      })
    })
  })

  describe('adminUpdateUser', () => {
    it('rejects username change for system admin', async () => {
      const { user } = await createSystemAdminFixture()

      await expect(
        adminUpdateUser(user._id.toString(), { username: 'newadmin' }),
      ).rejects.toMatchObject({
        statusCode: 403,
        message: 'user.system_admin_username_protected',
      })
    })

    it('rejects deactivation of system admin', async () => {
      const { user } = await createSystemAdminFixture()

      await expect(
        adminUpdateUser(user._id.toString(), { isActivated: false }),
      ).rejects.toMatchObject({
        statusCode: 403,
        message: 'user.system_admin_deactivation_protected',
      })
    })

    it('rejects removal of system admin role', async () => {
      const { user, otherRole } = await createSystemAdminFixture()

      await expect(
        adminUpdateUser(user._id.toString(), { roles: [otherRole._id.toString()] }),
      ).rejects.toMatchObject({
        statusCode: 403,
        message: 'user.system_admin_role_protected',
      })
    })

    it('allows adding extra roles while keeping system admin role', async () => {
      const { user, role, otherRole } = await createSystemAdminFixture()

      const updated = await adminUpdateUser(user._id.toString(), {
        roles: [role._id.toString(), otherRole._id.toString()],
      })

      expect((updated as any).roles.map(String)).toContain(role._id.toString())
      expect((updated as any).roles.map(String)).toContain(otherRole._id.toString())
    })

    it('allows changing name, surname, email of system admin', async () => {
      const { user } = await createSystemAdminFixture()

      const updated = await adminUpdateUser(user._id.toString(), {
        name: 'Ahmet',
        surname: 'Yilmaz',
        email: 'ahmet@factory.local',
      })

      expect((updated as any).name).toBe('Ahmet')
      expect((updated as any).surname).toBe('Yilmaz')
      expect((updated as any).email).toBe('ahmet@factory.local')
    })
  })

  describe('updateUser (self-update)', () => {
    it('rejects username change for system admin', async () => {
      const { user } = await createSystemAdminFixture()

      await expect(
        updateUser(user._id.toString(), { username: 'newadmin' } as any),
      ).rejects.toMatchObject({
        statusCode: 403,
        message: 'user.system_admin_username_protected',
      })
    })

    it('allows name change for system admin in self-update', async () => {
      const { user } = await createSystemAdminFixture()

      const updated = await updateUser(user._id.toString(), { name: 'Mehmet' } as any)

      expect((updated as any).name).toBe('Mehmet')
    })
  })
})
