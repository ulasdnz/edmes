import { inject } from 'vitest'
import type { ServiceName } from '../global-setup.js'

// Test files run in workers and cannot reach the service processes global setup started, so they
// ask its control server.
async function control(action: 'start' | 'stop', name: ServiceName) {
  const res = await fetch(`${inject('control')}/services/${name}/${action}`, { method: 'POST' })
  if (!res.ok) throw new Error(`${action} ${name} answered ${res.status}: ${await res.text()}`)
}

// Resolves once the process has exited
export const stopService = (name: ServiceName) => control('stop', name)

// Resolves once the service answers its readiness check on the address it had before
export const startService = (name: ServiceName) => control('start', name)
