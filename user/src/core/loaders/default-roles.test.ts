import { getInvalidPrivilegeCodes, PRIVILEGES } from '@mes/privileges'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ROLES } from '../../constants/default-roles.js'
import { emitRoleCreated, emitRoleUpdated } from '../../jobs/events.js'
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

const readCodes = PRIVILEGES.map(p => p.code).filter(code => code.startsWith('read'))

describe('ensureDefaultRoles', () => {
  beforeEach(async () => {
    vi.mocked(emitRoleCreated).mockClear()
    vi.mocked(emitRoleUpdated).mockClear()
    await ensureDefaultRoles({ firstInstall: true })
  })

  it('emits role.created once per role created and no update', async () => {
    expect(emitRoleCreated).toHaveBeenCalledTimes(5)
    const ids = (await Role.find({ key: { $exists: true } }).lean()).map(r => String(r._id))
    expect(
      vi
        .mocked(emitRoleCreated)
        .mock.calls.map(([id]) => id)
        .sort(),
    ).toEqual(ids.sort())
    expect(emitRoleUpdated).not.toHaveBeenCalled()
  })

  it('emits nothing for a role that needs no change', async () => {
    vi.mocked(emitRoleCreated).mockClear()
    await ensureDefaultRoles({ firstInstall: false })
    await ensureDefaultRoles({ firstInstall: true })
    expect(emitRoleCreated).not.toHaveBeenCalled()
    expect(emitRoleUpdated).not.toHaveBeenCalled()
  })

  it('creates the missing roles and leaves the existing ones alone on an interrupted first install', async () => {
    await Role.deleteMany({ key: { $in: ['quality', 'operator', 'viewer'] } })
    await Role.updateOne({ key: 'planner' }, { $set: { name: 'Planlamacı' } })
    vi.mocked(emitRoleCreated).mockClear()

    await ensureDefaultRoles({ firstInstall: true })

    const keys = (await Role.find({ key: { $exists: true } }).lean()).map(r => r.key).sort()
    expect(keys).toEqual(['operator', 'planner', 'quality', 'shiftSupervisor', 'viewer'])
    expect(emitRoleCreated).toHaveBeenCalledTimes(3)
    expect(emitRoleUpdated).not.toHaveBeenCalled()
    expect((await findRole('planner')).name).toBe('Planlamacı')
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
    vi.mocked(emitRoleUpdated).mockClear()
    await ensureDefaultRoles({ firstInstall: false })
    expect(emitRoleUpdated).toHaveBeenCalledTimes(1)
    expect((await findRole('viewer')).permissions).toContain('readOee')
    expect((await findRole('viewer')).defaultPermissions).toContain('readOee')

    await Role.updateOne({ key: 'viewer' }, { $pull: { permissions: 'readOee' } })
    await ensureDefaultRoles({ firstInstall: false })
    expect((await findRole('viewer')).permissions).not.toContain('readOee')
  })

  // scenario: DefaultRoles.firstInstall / happy path / the five names
  it('names the five roles', async () => {
    const roles = await Role.find({ key: { $exists: true } }).lean()
    expect(Object.fromEntries(roles.map(r => [r.key, r.name]))).toEqual({
      planner: 'Planner',
      shiftSupervisor: 'Shift Supervisor',
      quality: 'Quality',
      operator: 'Operator',
      viewer: 'Viewer',
    })
  })

  // scenario: DefaultRoles.firstInstall / happy path / defaultPermissions equals permissions
  it('stores defaultPermissions equal to permissions on each created role', async () => {
    const roles = await Role.find({ key: { $exists: true } }).lean()
    expect(roles).toHaveLength(5)
    for (const role of roles) {
      expect([...(role.defaultPermissions ?? [])].sort()).toEqual([...role.permissions].sort())
    }
  })

  // scenario: DefaultRoles.firstInstall / happy path / planner permissions
  it('gives the planner its exact permissions', async () => {
    expect([...(await findRole('planner')).permissions].sort()).toEqual(
      [
        'accessWebApp',
        ...readCodes,
        'writeProductionPlans',
        'deleteProductionPlans',
        'writeJobOrders',
        'deleteJobOrders',
        'writeSchedules',
        'writeProductStandards',
        'deleteProductStandards',
      ].sort(),
    )
  })

  // scenario: DefaultRoles.firstInstall / happy path / shiftSupervisor permissions
  it('gives the shift supervisor its exact permissions', async () => {
    expect([...(await findRole('shiftSupervisor')).permissions].sort()).toEqual(
      [
        'accessWebApp',
        'accessOperatorPanel',
        ...readCodes,
        'executeJobOrders',
        'writeOperators',
        'writeProductionAdjustments',
        'createUnplannedStops',
        'writeUnplannedStops',
        'executeUnplannedStops',
        'createPlannedStops',
        'writePlannedStops',
        'executePlannedStops',
        'executePlannedStopTemplates',
      ].sort(),
    )
  })

  // scenario: DefaultRoles.firstInstall / happy path / quality permissions
  it('gives the quality role its exact permissions', async () => {
    expect([...(await findRole('quality')).permissions].sort()).toEqual(
      [
        'accessWebApp',
        ...readCodes,
        'writeProductionAdjustments',
        'deleteProductionAdjustments',
        'createReasons',
        'writeReasons',
      ].sort(),
    )
  })

  // scenario: DefaultRoles.firstInstall / happy path / operator permissions
  it('gives the operator its exact permissions', async () => {
    expect([...(await findRole('operator')).permissions].sort()).toEqual(
      [
        'accessOperatorPanel',
        'readWorkCenters',
        'readSchedules',
        'readOperators',
        'writeOperators',
        'readCatalog',
        'readProductStandards',
        'readJobOrders',
        'executeJobOrders',
        'readProductionAdjustments',
        'writeProductionAdjustments',
        'readReasons',
        'readPlannedStops',
        'executePlannedStops',
        'readPlannedStopTemplates',
        'executePlannedStopTemplates',
        'readUnplannedStops',
        'createUnplannedStops',
        'writeUnplannedStops',
        'executeUnplannedStops',
        'readTags',
        'readHistorian',
        'readOee',
      ].sort(),
    )
  })

  // scenario: DefaultRoles.firstInstall / constraints / READ computed from PRIVILEGES
  it('gives every read privilege to planner, shiftSupervisor, quality and viewer', async () => {
    expect(readCodes.length).toBeGreaterThan(0)
    for (const key of ['planner', 'shiftSupervisor', 'quality', 'viewer']) {
      expect((await findRole(key)).permissions).toEqual(expect.arrayContaining(readCodes))
    }
  })

  // scenario: DefaultRoles.firstInstall / constraints / duplicate key rejected
  it('rejects a second role with an existing key', async () => {
    await Role.init()
    await expect(
      Role.create({ key: 'planner', name: 'Another planner', permissions: [] }),
    ).rejects.toThrow(/duplicate key|E11000/)
  })

  // scenario: DefaultRoles.firstInstall / constraints / several roles without key allowed
  it('allows several roles without a key', async () => {
    await Role.init()
    await Role.create({ name: 'customer-a', permissions: [] })
    await Role.create({ name: 'customer-b', permissions: [] })
    await Role.create({ name: 'customer-c', permissions: [] })
    expect(await Role.countDocuments({ key: { $exists: false } })).toBe(3)
  })

  // scenario: DefaultRoles.firstInstall / authorization / only shiftSupervisor holds both access codes
  it('gives both application access codes to the shift supervisor only', async () => {
    const roles = await Role.find({ key: { $exists: true } }).lean()
    const both = roles
      .filter(
        r =>
          r.permissions.includes('accessWebApp') && r.permissions.includes('accessOperatorPanel'),
      )
      .map(r => r.key)
    expect(both).toEqual(['shiftSupervisor'])
    for (const key of ['planner', 'quality', 'viewer']) {
      expect((await findRole(key)).permissions).not.toContain('accessOperatorPanel')
    }
  })

  // scenario: DefaultRoles.laterRuns / happy path / defaultPermissions equals the current definition
  it('sets defaultPermissions to the current definition after a later run', async () => {
    await Role.updateOne(
      { key: 'viewer' },
      { $pull: { permissions: 'readOee', defaultPermissions: 'readOee' } },
    )
    await ensureDefaultRoles({ firstInstall: false })
    const definition = DEFAULT_ROLES.find(r => r.key === 'viewer')
    expect([...((await findRole('viewer')).defaultPermissions ?? [])].sort()).toEqual(
      [...(definition?.permissions ?? [])].sort(),
    )
  })

  // scenario: DefaultRoles.laterRuns / constraints / found by key, renamed role gets new code
  it('gives a renamed role a code that is new in its definition', async () => {
    await Role.updateOne(
      { key: 'viewer' },
      {
        $set: { name: 'Goruntuleyici' },
        $pull: { permissions: 'readOee', defaultPermissions: 'readOee' },
      },
    )
    await ensureDefaultRoles({ firstInstall: false })
    const viewer = await findRole('viewer')
    expect(viewer.name).toBe('Goruntuleyici')
    expect(viewer.permissions).toContain('readOee')
  })

  // scenario: DefaultRoles.laterRuns / edge cases / extra customer code stays
  it('keeps a code the customer added to a ready-made role', async () => {
    await Role.updateOne({ key: 'viewer' }, { $addToSet: { permissions: 'writeUsers' } })
    await ensureDefaultRoles({ firstInstall: false })
    expect((await findRole('viewer')).permissions).toContain('writeUsers')
  })
})
