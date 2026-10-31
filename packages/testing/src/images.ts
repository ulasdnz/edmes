import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The image docker-compose.yml runs for a service. Tests start the same one, so a Dependabot bump of
// the compose file is tested before it merges.
export function composeImage(service: string): string {
  const compose = readFileSync(
    fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)),
    'utf8',
  )
  const lines = compose.split(/\r?\n/)
  const start = lines.indexOf(`  ${service}:`)
  // The service's image line, or the next service if it has none
  const line = lines.slice(start + 1).find(l => l.startsWith('    image: ') || /^ {2}\S/.test(l))
  if (start < 0 || !line?.startsWith('    image: ')) {
    throw new Error(`docker-compose.yml names no image for ${service}`)
  }
  return line.slice('    image: '.length).trim()
}

// The same version without the digest: Testcontainers' MongoDB module picks its shell by the version
// in the tag, and `name:tag@digest` parses as tag `sha256:...`, which falls back to the shell MongoDB
// 6 removed, so the container never turns healthy
export const MONGO_IMAGE = composeImage('mongodb').replace(/@sha256:[0-9a-f]+$/, '')
