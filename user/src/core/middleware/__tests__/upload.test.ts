import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '../../loaders/i18n.js'
import { errorHandler } from '../error-handler.js'
import { saveImage, uploadImage } from '../upload.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
])
const html = Buffer.from('<html><body><script>alert(document.cookie)</script></body></html>')
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"/>')

const file = (buffer: Buffer, originalname: string, mimetype: string) =>
  ({
    fieldname: 'photo',
    originalname,
    mimetype,
    buffer,
    size: buffer.length,
  }) as Express.Multer.File

const uploadedContents = async () => {
  const names = await fs.readdir('uploads')
  return Promise.all(names.map(name => fs.readFile(path.join('uploads', name))))
}

describe('saveImage', () => {
  const saved: string[] = []

  afterEach(async () => {
    await Promise.all(saved.splice(0).map(url => fs.rm(`.${url}`, { force: true })))
  })

  it('names the file by the format of its content, not by what the client sent', async () => {
    const url = await saveImage(file(png, 'avatar.html', 'text/html'))
    saved.push(url)

    expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/)
    expect(await fs.readFile(`.${url}`)).toEqual(png)
  })

  it.each([
    ['JPEG', '.jpg', jpeg],
    ['WebP', '.webp', webp],
  ])('stores a %s image with the %s extension', async (_format, extension, content) => {
    const url = await saveImage(file(content, 'photo', 'image/png'))
    saved.push(url)

    expect(path.extname(url)).toBe(extension)
  })

  it.each([
    ['an HTML page sent as a PNG', html, 'image/png'],
    ['an SVG, which can carry scripts', svg, 'image/svg+xml'],
  ])('rejects %s and writes nothing', async (_case, content, mimetype) => {
    await expect(saveImage(file(content, 'avatar.png', mimetype))).rejects.toMatchObject({
      statusCode: 400,
      message: 'upload.only_images',
    })

    expect((await uploadedContents()).some(stored => stored.equals(content))).toBe(false)
  })
})

describe('uploadImage', () => {
  let app: express.Express

  beforeAll(async () => {
    app = express()
    app.use(await initI18n())
    app.patch('/avatar', uploadImage('photo'), (req, res) => {
      res.json({ size: req.file?.buffer.length })
    })
    app.use(errorHandler)
  })

  it('hands the file over in memory, for its content to be checked before it is stored', async () => {
    const res = await request(app).patch('/avatar').attach('photo', png, 'avatar.png')

    expect(res.status).toBe(200)
    expect(res.body.size).toBe(png.length)
  })

  it('answers a file over 5 MB with 400, not a server error', async () => {
    const res = await request(app)
      .patch('/avatar')
      .attach('photo', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({
      code: 'upload.file_too_large',
      message: 'File must be 5 MB or smaller',
    })
  })

  it('answers a file sent under another field with 400', async () => {
    const res = await request(app).patch('/avatar').attach('avatar', png, 'avatar.png')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('upload.invalid_file')
  })
})
