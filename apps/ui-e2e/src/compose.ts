import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The repository root, where docker-compose.yml names this project
export const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))

export function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    // A failure carries stderr in its error; a success keeps the test output clean
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  })
}
