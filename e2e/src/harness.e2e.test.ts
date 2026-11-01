import { describe, expect, inject, it } from 'vitest'
import { startService, stopService } from './support/services.js'

describe('e2e harness', () => {
  it('restarts a service on the same address', async () => {
    const health = `${inject('urls').telemetry}/health/ready`

    await stopService('telemetry')
    // The service comes back even if the check fails, so the tests after this one still have it
    try {
      await expect(fetch(health)).rejects.toMatchObject({ cause: { code: 'ECONNREFUSED' } })
    } finally {
      await startService('telemetry')
    }

    expect((await fetch(health)).status).toBe(200)
  })
})
