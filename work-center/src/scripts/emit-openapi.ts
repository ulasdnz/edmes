import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApiDocument } from '../lib/openapi/document.js'

const target = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/api-client/openapi/work-center.json',
)

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify(openApiDocument, null, 2)}\n`)
process.stdout.write(`wrote ${target}\n`)
