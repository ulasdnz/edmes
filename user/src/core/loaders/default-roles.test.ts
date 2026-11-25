import { getInvalidPrivilegeCodes, PRIVILEGES } from '@mes/privileges'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ROLES } from '../../constants/default-roles.js'
import Role from '../../modules/role/role.model.js'
import { ensureDefaultRoles } from './default-roles.js'

vi.mock('../../jobs/events.js', () => ({
  emitRoleCreated: vi.fn(),
  emitRoleUpdated: vi.fn(),
}))

const findRole = async (key: string) => {
  const role = await Role.findOne({ key }).lean()
  if (!role) throw new Error(`role ${key} missing`)
  return role
}

describe('ensureDefaultRoles', () => {
  beforeEach(async () => {
    await ensureDefaultRoles({ firstInstall: true })
  })

  it('creates the five roles on first install', async () => {
    const keys = (await Role.find({ key: { $exists: true } }).lean()).map(r => r.key).sort()
    expect(keys).toEqual(['operator', 'planner', 'quality', 'shiftSupervisor', 'viewer'])
  })

  it('gives the operator the panel and not the web app', async () => {
    const operator = await findRole('operator')
    expect(operator.permissions).toContain('accessOperatorPanel')
    expect(operator.permissions).toContain('readJobOrders')
    expect(operator.permissions).not.toContain('accessWebApp')
  })

  it('gives the viewer every read privilege and nothing that changes data', async () => {
    const viewer = await findRole('viewer')
    const reads = PRIVILEGES.map(p => p.code).filter(code => code.startsWith('read'))
    expect([...viewer.permissions].sort()).toEqual(['accessWebApp', ...reads].sort())
  })

  it('stores the applied definition as defaultPermissions', async () => {
    for (const definition of DEFAULT_ROLES) {
      const role = await findRole(definition.key)
      expect([...(role.defaultPermissions ?? [])].sort()).toEqual(
        [...definition.permissions].sort(),
      )
    }
  })

  it('uses only valid privilege codes', () => {
    expect(getInvalidPrivilegeCodes(DEFAULT_ROLES.flatMap(r => [...r.permissions]))).toEqual([])
  })

  it('does not create roles when it is not the first install', async () => {
    await Role.deleteMany({ key: { $exists: true } })
    await ensureDefaultRoles({ firstInstall: false })
    expect(await Role.countDocuments({ key: { $exists: true } })).toBe(0)
  })

  it('does not recreate a role the customer deleted', async () => {
    await Role.deleteOne({ key: 'quality' })
    await ensureDefaultRoles({ firstInstall: false })
    expect(await Role.exists({ key: 'quality' })).toBeNull()
  })

  it('keeps what the customer removed and renamed', async () => {
    await Role.updateOne(
      { key: 'planner' },
      { $set: { name: 'Planlamacı' }, $pull: { permissions: 'deleteJobOrders' } },
    )
    await ensureDefaultRoles({ firstInstall: false })
    const planner = await findRole('planner')
    expect(planner.name).toBe('Planlamacı')
    expect(planner.permissions).not.toContain('deleteJobOrders')
  })

  it('adds a privilege that is new in the definition exactly once', async () => {
    await Role.updateOne(
      { key: 'viewer' },
      { $pull: { permissions: 'readOee', defaultPermissions: 'readOee' } },
    )
    await ensureDefaultRoles({ firstInstall: false })
    expect((await findRole('viewer')).permissions).toContain('readOee')
    expect((await findRole('viewer')).defaultPermissions).toContain('readOee')

    await Role.updateOne({ key: 'viewer' }, { $pull: { permissions: 'readOee' } })
    await ensureDefaultRoles({ firstInstall: false })
    expect((await findRole('viewer')).permissions).not.toContain('readOee')
  })
})
