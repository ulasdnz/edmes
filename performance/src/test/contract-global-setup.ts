import { MONGO_ENVIRONMENT, MONGO_IMAGE, REDIS_IMAGE } from '@mes/testing'
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

let mongoContainer: StartedMongoDBContainer
let redisContainer: StartedTestContainer

export async function setup() {
  mongoContainer = await new MongoDBContainer(MONGO_IMAGE)
    .withEnvironment(MONGO_ENVIRONMENT)
    .start()
  let uri = mongoContainer.getConnectionString()
  if (!uri.includes('directConnection=true')) {
    uri += uri.includes('?') ? '&directConnection=true' : '?directConnection=true'
  }
  uri = uri.replace('localhost', '127.0.0.1')

  redisContainer = await new GenericContainer(REDIS_IMAGE).withExposedPorts(6379).start()
  const redisPort = redisContainer.getMappedPort(6379)
  const redisUrl = `redis://127.0.0.1:${redisPort}`

  // Set env here — vitest forks inherit process.env from the main process
  process.env.MONGO_URI = uri
  process.env.REDIS_URL = redisUrl
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test-secret-32-chars-minimum-ok!'
  process.env.INTERNAL_API_TOKEN = 'test-internal-api-token-at-least-32-chars'
  process.env.LOG_LEVEL = 'error'
  process.env.INTERNAL_API_USER = 'http://127.0.0.1:19901'
  process.env.INTERNAL_API_WORK_CENTER = 'http://127.0.0.1:19902'
  process.env.INTERNAL_API_PRODUCTION = 'http://127.0.0.1:19903'
  process.env.INTERNAL_API_TELEMETRY = 'http://127.0.0.1:19904'
}

export async function teardown() {
  await mongoContainer?.stop()
  await redisContainer?.stop()
}
