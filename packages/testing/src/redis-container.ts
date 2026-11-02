import { GenericContainer } from 'testcontainers'
import { REDIS_IMAGE } from './images.js'

export interface RedisTestContainer {
  url: string
  stop: () => Promise<void>
}

// A service builds its Redis clients from REDIS_URL when their module loads, so a test that needs
// them on a real Redis starts this in vi.hoisted and sets REDIS_URL before its imports run
export async function startRedisTestContainer(): Promise<RedisTestContainer> {
  const container = await new GenericContainer(REDIS_IMAGE).withExposedPorts(6379).start()
  return {
    url: `redis://127.0.0.1:${container.getMappedPort(6379)}`,
    stop: async () => {
      await container.stop()
    },
  }
}
