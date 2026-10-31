import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import User from '../user.model.js'
import { updateAvatar } from '../user.service.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const html = Buffer.from('<html><body><script>alert(document.cookie)</script></body></html>')

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
