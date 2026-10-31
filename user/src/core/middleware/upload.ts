import type { RequestHandler } from 'express'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import CustomError from '../errors/index.js'

const uploadDir = 'uploads/'

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// The formats an uploaded image may have, known by their first bytes (null matches any byte). The
// name and type the client sends are its own claims, and a stored file is served back from this
// origin with the content type of its extension: an HTML or SVG file would run as a page.
const imageFormats: { extension: string; signature: (number | null)[] }[] = [
  { extension: '.jpg', signature: [0xff, 0xd8, 0xff] },
  { extension: '.png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // RIFF, the chunk size, then WEBP
  {
    extension: '.webp',
    signature: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
]

const upload = multer({
  // Held in memory until its content is checked, so nothing unchecked reaches the served directory
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
})

export const uploadImage = (field: string): RequestHandler => {
  const single = upload.single(field)
  return (req, res, next) => {
    single(req, res, (err?: unknown) => {
      if (!err) return next()
      // With the file in memory, every error here comes from the request itself: a file over the
      // limit, an unexpected field, a malformed or cut-off multipart body
      const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
      next(new CustomError(400, tooLarge ? 'upload.file_too_large' : 'upload.invalid_file'))
    })
  }
}

// Stores an uploaded image under a new name with the extension of its actual format, and returns
// the path it is served at
export const saveImage = async (file: Express.Multer.File): Promise<string> => {
  const format = imageFormats.find(({ signature }) =>
    signature.every((byte, i) => byte === null || file.buffer[i] === byte),
  )
  if (!format) {
    throw new CustomError(400, 'upload.only_images')
  }

  const filename = `${uuidv4()}${format.extension}`
  await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer)
  return `/uploads/${filename}`
}
