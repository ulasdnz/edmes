import fs from 'node:fs/promises'
import type { Express, NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { config } from '../../../config/index.js'
import { initLoaders } from '../../../core/loaders/index.js'
import { streamClient } from '../../../lib/redis.js'
import User from '../user.model.js'
import { removeAvatar, updateAvatar } from '../user.service.js'

vi.mock('../../../core/loaders/mongoose', () => ({
  initMongoose: vi.fn(),
}))

vi.mock('../../../database/migrations/index', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('../../../jobs/subscribers', () => ({
  initSubscribers: vi.fn(),
  shutdownSubscribers: vi.fn(),
}))

vi.mock('../../../lib/redis', () => {
  const client = {
    connect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
  }
  return {
    initRedis: vi.fn(),
    closeRedis: vi.fn(),
    redisClient: client,
    sharedClient: client,
    streamClient: {
      connect: vi.fn(),
      ping: vi.fn().mockResolvedValue('PONG'),
      xadd: vi.fn().mockResolvedValue('1-0'),
      xreadgroup: vi.fn().mockResolvedValue(null),
      xgroup: vi.fn(),
      xack: vi.fn(),
      quit: vi.fn(),
    },
  }
})

vi.mock('../../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  morganMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}))

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const html = Buffer.from('<html><body><script>alert(document.cookie)</script></body></html>')

// The user.updated events published for one user: other tabs and devices refresh the session on it
function userUpdatedEvents(userId: string): unknown[][] {
  const calls = (streamClient.xadd as unknown as Mock).mock.calls as unknown[][]
  return calls.filter(call => {
    if (!call.includes('user.updated')) return false
    const data = JSON.parse(String(call[call.indexOf('data') + 1])) as { userId?: string }
    return data.userId === userId
  })
}

const file = (buffer: Buffer, originalname: string, mimetype: string) =>
  ({
    fieldname: 'photo',
    originalname,
    mimetype,
    buffer,
    size: buffer.length,
  }) as Express.Multer.File

describe('updateAvatar', () => {
  let userId: string
  const stored: string[] = []

  beforeEach(async () => {
    const user = await User.create({
      username: 'avatar.owner',
      email: 'avatar.owner@example.com',
      password: 'not-a-real-hash',
      name: 'Avatar',
      surname: 'Owner',
    })
    userId = user.id
  })

  afterEach(async () => {
    await Promise.all(stored.splice(0).map(url => fs.rm(`.${url}`, { force: true })))
  })

  it('stores the new image and removes the previous one', async () => {
    const first = await updateAvatar(userId, file(png, 'first.png', 'image/png'))
    const second = await updateAvatar(userId, file(png, 'second.png', 'image/png'))
    stored.push(second.photoUrl as string)

    expect(second.photoUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/)
    await expect(fs.access(`.${first.photoUrl}`)).rejects.toThrow()
    expect(await fs.readFile(`.${second.photoUrl}`)).toEqual(png)
  })

  it('announces user.updated for every new avatar', async () => {
    await updateAvatar(userId, file(png, 'first.png', 'image/png'))
    const second = await updateAvatar(userId, file(png, 'second.png', 'image/png'))
    stored.push(second.photoUrl as string)

    expect(userUpdatedEvents(userId)).toHaveLength(2)
  })

  it('keeps the avatar and its file when saving the removal fails', async () => {
    const current = await updateAvatar(userId, file(png, 'current.png', 'image/png'))
    stored.push(current.photoUrl as string)
    vi.spyOn(User.prototype, 'save').mockRejectedValueOnce(new Error('write failed'))

    await expect(removeAvatar(userId)).rejects.toThrow('write failed')

    expect((await User.findById(userId))?.photoUrl).toBe(current.photoUrl)
    expect(await fs.readFile(`.${current.photoUrl}`)).toEqual(png)
    vi.restoreAllMocks()
  })

  it('announces user.updated when an avatar is removed, and nothing when there was none', async () => {
    const current = await updateAvatar(userId, file(png, 'current.png', 'image/png'))
    stored.push(current.photoUrl as string)
    const before = userUpdatedEvents(userId).length

    await removeAvatar(userId)
    expect(userUpdatedEvents(userId)).toHaveLength(before + 1)

    await removeAvatar(userId)
    expect(userUpdatedEvents(userId)).toHaveLength(before + 1)
  })

  it('keeps the current avatar when the new upload is not an image', async () => {
    const current = await updateAvatar(userId, file(png, 'current.png', 'image/png'))
    stored.push(current.photoUrl as string)

    await expect(updateAvatar(userId, file(html, 'next.png', 'image/png'))).rejects.toMatchObject({
      statusCode: 400,
      message: 'upload.only_images',
    })

    expect((await User.findById(userId))?.photoUrl).toBe(current.photoUrl)
    expect(await fs.readFile(`.${current.photoUrl}`)).toEqual(png)
  })
})

describe('DELETE /api/v1/users/me/avatar', () => {
  let app: Express
  const stored: string[] = []

  beforeAll(async () => {
    app = await initLoaders()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(stored.splice(0).map(url => fs.rm(`.${url}`, { force: true })))
  })

  // The auth middleware resolves the caller over HTTP from user-service itself: the same app
  function routeAuthContextToApp() {
    const realFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.startsWith(config.INTERNAL_API_USER)) return realFetch(input, init)
      const res = await request(app)
        .get(url.slice(config.INTERNAL_API_USER.length))
        .set(init?.headers as Record<string, string>)
      return new Response(JSON.stringify(res.body), { status: res.status })
    })
  }

  async function createOwner(suffix: string) {
    const user = await User.create({
      username: `avatar.remove.${suffix}`,
      email: `avatar.remove.${suffix}@example.com`,
      password: 'not-a-real-hash',
      name: 'Avatar',
      surname: 'Remover',
    })
    return { user, token: jwt.sign({ id: user._id.toString() }, config.JWT_SECRET) }
  }

  async function upload(token: string): Promise<string> {
    const res = await request(app)
      .patch('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', png, 'face.png')
    expect(res.status).toBe(200)
    stored.push(res.body.data.photoUrl)
    return res.body.data.photoUrl
  }

  // scenario: UserMe.avatarRemove / happy path / uploaded avatar removed, file gone from the volume
  it('removes the uploaded avatar, answers { data, message } and deletes the file', async () => {
    routeAuthContextToApp()
    const { token } = await createOwner('happy')
    const photoUrl = await upload(token)
    expect(await fs.readFile(`.${photoUrl}`)).toEqual(png)

    const res = await request(app)
      .delete('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.message).toEqual(expect.any(String))
    expect(res.body.data.photoUrl).toBeNull()
    const me = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)
    expect(me.status).toBe(200)
    expect(me.body.data.photoUrl ?? null).toBeNull()
    await expect(fs.access(`.${photoUrl}`)).rejects.toThrow()
  })

  // scenario: UserMe.avatarRemove / boundaries / no avatar → 200, data.avatar null
  it('answers 200 with no avatar when there is none to remove', async () => {
    routeAuthContextToApp()
    const { token } = await createOwner('none')

    const res = await request(app)
      .delete('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.message).toEqual(expect.any(String))
    expect(res.body.data.photoUrl).toBeNull()
  })

  // scenario: UserMe.avatarRemove / authorization / [CRITICAL] no token → 401; only the caller's own avatar
  it('answers 401 without a token and only ever removes the caller own avatar', async () => {
    routeAuthContextToApp()
    const owner = await createOwner('owner')
    const other = await createOwner('other')
    const ownerPhoto = await upload(owner.token)

    const anonymous = await request(app).delete('/api/v1/users/me/avatar')
    expect(anonymous.status).toBe(401)
    expect(anonymous.body.error.code).toEqual(expect.any(String))

    const res = await request(app)
      .delete('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${other.token}`)
    expect(res.status).toBe(200)
    expect((await User.findById(owner.user._id))?.photoUrl).toBe(ownerPhoto)
    expect(await fs.readFile(`.${ownerPhoto}`)).toEqual(png)
  })
})
