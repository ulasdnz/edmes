import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compose } from './compose'

// The logs of every service, green runs too, so a failure can be read against a passing baseline.
export default function globalTeardown() {
  const directory = fileURLToPath(new URL('../logs', import.meta.url))
  mkdirSync(directory, { recursive: true })
  const services = compose('config', '--services').split('\n').filter(Boolean)
  for (const service of services) {
    writeFileSync(join(directory, `${service}.log`), compose('logs', '--no-color', service))
  }
}
