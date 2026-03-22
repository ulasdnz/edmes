import { describe, expect, it, vi } from 'vitest'
import { PRIVILEGES } from '../../../constants/privileges.js'
import Role from '../../../modules/role/role.model.js'
import User from '../../../modules/user/user.model.js'
import { initLoaders } from '../index.js'

vi.mock('../mongoose.js', () => ({
  initMongoose: vi.fn(),
}))

vi.mock('../express.js', () => ({
  initExpress: vi.fn().mockResolvedValue({}),
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

describe('system admin bootstrap', () => {
  it('creates a full-access system admin role and user on startup', async () => {
    await initLoaders()

    const role = await Role.findOne({ name: 'System Administrator' }).lean()
    const user = await User.findOne({ email: 'system.admin@example.local' }).lean()

    expect(role).toBeTruthy()
    expect(role?.permissions).toHaveLength(PRIVILEGES.length)
    expect(role?.permissions).toEqual(expect.arrayContaining(PRIVILEGES.map(p => p.code)))
    expect(role?.isDefault).toBe(false)

    expect(user).toBeTruthy()
    expect(user?.username).toBe('system.admin')
    expect(user?.isActivated).toBe(true)
    expect(user?.roles.map(String)).toContain(String(role?._id))
  })

  it('is idempotent and repairs the bootstrapped role and user on repeated startup', async () => {
    await initLoaders()

    const role = await Role.findOne({ name: 'System Administrator' })
    const user = await User.findOne({ email: 'system.admin@example.local' })

    expect(role).toBeTruthy()
    expect(user).toBeTruthy()

    await Role.findOneAndUpdate(
      { _id: role!._id },
      {
        $set: {
          permissions: ['readUsers'],
          isDefault: true,
          description: 'stale',
        },
      },
      { returnDocument: 'after' },
    )

    await User.findOneAndUpdate(
      { _id: user!._id },
      {
        $set: {
          username: 'stale.system',
          roles: [],
          isActivated: false,
        },
      },
      { returnDocument: 'after' },
    )

    await initLoaders()

    const syncedRole = await Role.findOne({ name: 'System Administrator' }).lean()
    const syncedUser = await User.findOne({ email: 'system.admin@example.local' }).lean()

    expect(await Role.countDocuments({ name: 'System Administrator' })).toBe(1)
    expect(await User.countDocuments({ email: 'system.admin@example.local' })).toBe(1)

    expect(syncedRole?.permissions).toHaveLength(PRIVILEGES.length)
    expect(syncedRole?.permissions).toEqual(expect.arrayContaining(PRIVILEGES.map(p => p.code)))
    expect(syncedRole?.isDefault).toBe(false)
    expect(syncedRole?.description).toBe('Bootstrapped full-access system administrator role')

    expect(syncedUser?.username).toBe('system.admin')
    expect(syncedUser?.isActivated).toBe(true)
    expect(syncedUser?.roles.map(String)).toContain(String(role!._id))
  })
})
