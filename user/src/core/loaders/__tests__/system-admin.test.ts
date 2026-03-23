import { describe, expect, it, vi } from 'vitest'
import { PRIVILEGES } from '../../../constants/privileges.js'
import { SYSTEM_ADMIN_ROLE_NAME, SYSTEM_ADMIN_USERNAME } from '../../../constants/system-admin.js'
import Role from '../../../modules/role/role.model.js'
import User from '../../../modules/user/user.model.js'
import { initLoaders } from '../index.js'

vi.mock('../mongoose.js', () => ({
  initMongoose: vi.fn(),
}))

vi.mock('../express.js', () => ({
  initExpress: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../../database/migrations/index.js', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('../../../jobs/subscribers.js', () => ({
  initSubscribers: vi.fn(),
  shutdownSubscribers: vi.fn(),
}))

vi.mock('../../../jobs/events.js', () => ({
  emitUserCreated: vi.fn(),
  emitUserUpdated: vi.fn(),
  emitUserDeleted: vi.fn(),
  emitRoleCreated: vi.fn(),
  emitRoleUpdated: vi.fn(),
  emitRoleDeleted: vi.fn(),
}))

vi.mock('../../../lib/redis.js', () => ({
  initRedis: vi.fn(),
  closeRedis: vi.fn(),
  redisClient: {
    connect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
  },
  streamClient: {
    connect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    xadd: vi.fn().mockResolvedValue('1-0'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xgroup: vi.fn(),
    xack: vi.fn(),
    quit: vi.fn(),
  },
}))

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  morganMiddleware: vi.fn(),
  httpLoggerMiddleware: vi.fn(),
}))

const systemUsername = SYSTEM_ADMIN_USERNAME
const systemRoleName = SYSTEM_ADMIN_ROLE_NAME

describe('system admin bootstrap', () => {
  it('creates a full-access system admin role and user on startup', async () => {
    await initLoaders()

    const role = await Role.findOne({ name: systemRoleName }).lean()
    const user = await User.findOne({ username: systemUsername }).lean()

    expect(role).toBeTruthy()
    expect(role?.permissions).toHaveLength(PRIVILEGES.length)
    expect(role?.permissions).toEqual(expect.arrayContaining(PRIVILEGES.map(p => p.code)))
    expect(role?.isDefault).toBe(false)

    expect(user).toBeTruthy()
    expect(user?.username).toBe(systemUsername)
    expect(user?.isActivated).toBe(true)
    expect(user?.roles.map(String)).toContain(String(role?._id))
  })

  it('is idempotent — no duplicates on repeated startup', async () => {
    await initLoaders()
    await initLoaders()

    expect(await Role.countDocuments({ name: systemRoleName })).toBe(1)
    expect(await User.countDocuments({ username: systemUsername })).toBe(1)
  })

  it('syncs role permissions and description on repeated startup', async () => {
    await initLoaders()

    const role = await Role.findOne({ name: systemRoleName })

    await Role.findOneAndUpdate(
      { _id: role!._id },
      {
        $set: {
          permissions: ['readUsers'],
          isDefault: true,
          description: 'stale',
        },
      },
    )

    await initLoaders()

    const syncedRole = await Role.findOne({ name: systemRoleName }).lean()

    expect(syncedRole?.permissions).toHaveLength(PRIVILEGES.length)
    expect(syncedRole?.permissions).toEqual(expect.arrayContaining(PRIVILEGES.map(p => p.code)))
    expect(syncedRole?.isDefault).toBe(false)
    expect(syncedRole?.description).toBe('Bootstrapped full-access system administrator role')
  })

  it('preserves user changes to name, email and surname across restarts', async () => {
    await initLoaders()

    const user = await User.findOne({ username: systemUsername })

    await User.findOneAndUpdate(
      { _id: user!._id },
      {
        $set: {
          name: 'Ahmet',
          surname: 'Yilmaz',
          email: 'ahmet@factory.local',
        },
      },
    )

    await initLoaders()

    const syncedUser = await User.findOne({ username: systemUsername }).lean()

    expect(syncedUser?.name).toBe('Ahmet')
    expect(syncedUser?.surname).toBe('Yilmaz')
    expect(syncedUser?.email).toBe('ahmet@factory.local')
  })

  it('re-adds system admin role if removed from user', async () => {
    await initLoaders()

    const role = await Role.findOne({ name: systemRoleName }).lean()
    const user = await User.findOne({ username: systemUsername })

    await User.findOneAndUpdate({ _id: user!._id }, { $set: { roles: [] } })

    await initLoaders()

    const syncedUser = await User.findOne({ username: systemUsername }).lean()
    expect(syncedUser?.roles.map(String)).toContain(String(role?._id))
  })

  it('reactivates user if deactivated', async () => {
    await initLoaders()

    const user = await User.findOne({ username: systemUsername })

    await User.findOneAndUpdate({ _id: user!._id }, { $set: { isActivated: false } })

    await initLoaders()

    const syncedUser = await User.findOne({ username: systemUsername }).lean()
    expect(syncedUser?.isActivated).toBe(true)
  })

  it('does not reset password on repeated startup', async () => {
    await initLoaders()

    const userBefore = await User.findOne({ username: systemUsername }).select('+password').lean()
    const passwordBefore = userBefore!.password

    await initLoaders()

    const userAfter = await User.findOne({ username: systemUsername }).select('+password').lean()
    expect(userAfter!.password).toBe(passwordBefore)
  })
})
