import type { AddressInfo } from 'node:net'
import { REDIS_IMAGE } from '@mes/testing/images'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let container: StartedTestContainer

beforeAll(async () => {
  container = await new GenericContainer(REDIS_IMAGE).withExposedPorts(6379).start()
  // Read by the config module when the imports below load it
  process.env.REDIS_URL = `redis://${container.getHost()}:${container.getMappedPort(6379)}`
}, 120000)

afterAll(async () => {
  await container?.stop()
})

describe('readiness', () => {
  it('stays ready while the stream consumer waits in its blocking read', async () => {
    const { closeRedis, initRedis } = await import('../../lib/redis.js')
    const { initSubscribers, shutdownSubscribers } = await import('../../jobs/subscribers.js')
    const { initExpress } = await import('./express.js')

    await initRedis()
    initSubscribers()
    // Time for the consumer to create its groups and enter XREADGROUP ... BLOCK
    await new Promise(resolve => setTimeout(resolve, 500))

    const server = (await initExpress()).listen(0)
    try {
      const { port } = server.address() as AddressInfo
      // Docker marks the container unhealthy after three failed probes in a row
      for (let probe = 0; probe < 3; probe++) {
        const res = await fetch(`http://127.0.0.1:${port}/health/ready`)
        expect(res.status).toBe(200)
      }
    } finally {
      server.close()
      await shutdownSubscribers()
      await closeRedis()
    }
  }, 60000)
})
