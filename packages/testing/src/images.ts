import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A service's lines in docker-compose.yml, up to the next service
function composeService(service: string): string[] {
  const lines = readFileSync(
    fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)),
    'utf8',
  ).split(/\r?\n/)
  const start = lines.indexOf(`  ${service}:`)
  if (start < 0) throw new Error(`docker-compose.yml has no service ${service}`)
  const end = lines.findIndex((l, i) => i > start && /^ {0,2}\S/.test(l))
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

// The image docker-compose.yml runs for a service. Tests start the same one, so a Dependabot bump of
// the compose file is tested before it merges.
export function composeImage(service: string): string {
  const line = composeService(service).find(l => l.startsWith('    image: '))
  if (!line) throw new Error(`docker-compose.yml names no image for ${service}`)
  return line.slice('    image: '.length).trim()
}

// The `KEY=value` entries of a service's environment list in docker-compose.yml
function composeEnvironment(service: string): Record<string, string> {
  const lines = composeService(service)
  const start = lines.indexOf('    environment:')
  const environment: Record<string, string> = {}
  if (start < 0) return environment
  for (const line of lines.slice(start + 1)) {
    if (/^ {4}\S/.test(line)) break
    const entry = line.match(/^ {6}- ([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (entry) environment[entry[1]] = entry[2]
  }
  return environment
}

// The same version without the digest: Testcontainers' MongoDB module picks its shell by the version
// in the tag, and `name:tag@digest` parses as tag `sha256:...`, which falls back to the shell MongoDB
// 6 removed, so the container never turns healthy
export const MONGO_IMAGE = composeImage('mongodb').replace(/@sha256:[0-9a-f]+$/, '')

// What compose sets for MongoDB, among it what MongoDB needs to start on the runner's kernel
export const MONGO_ENVIRONMENT = composeEnvironment('mongodb')

// The compose image as it is: a GenericContainer takes `name:tag@digest`, so the digest stays
export const REDIS_IMAGE = composeImage('redis')
