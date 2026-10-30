import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import type { TestProject } from 'vitest/node'

// Starts MongoDB, Redis and an MQTT broker in containers and the built services as plain Node
// processes, the way they run in production. Tests reach the services only over HTTP and MQTT.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const LOG_DIR = resolve(ROOT, 'e2e/logs')

const PORTS = {
  user: 39100,
  'work-center': 39101,
  production: 39102,
  telemetry: 39103,
  performance: 39104,
}
export type ServiceName = keyof typeof PORTS

const INTERNAL_TOKEN = 'e2e-internal-api-token-at-least-32-chars'
const ADMIN = { email: 'admin@e2e.test', password: 'E2e-Admin-2026' }
const MQTT = { username: 'e2e', password: 'e2e' }

declare module 'vitest' {
  export interface ProvidedContext {
    urls: Record<ServiceName, string>
    mqtt: { url: string; username: string; password: string }
    internalToken: string
    admin: { email: string; password: string }
    logDir: string
  }
}

const serviceUrl = (name: ServiceName) => `http://127.0.0.1:${PORTS[name]}`

async function waitUntilReady(name: ServiceName, child: ChildProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const res = await fetch(`${serviceUrl(name)}/health/ready`)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise(r => setTimeout(r, 250))
  }
  const log = await readFile(resolve(LOG_DIR, `${name}.log`), 'utf8').catch(() => '')
  throw new Error(`${name} did not become ready:\n${log.split('\n').slice(-30).join('\n')}`)
}

export default async function setup(project: TestProject) {
  const [mongo, redis, broker] = await Promise.all([
    new GenericContainer('mongo:7')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer('eclipse-mosquitto:2')
      .withExposedPorts(1883)
      .withCopyContentToContainer([
        {
          content: 'listener 1883\nallow_anonymous true\n',
          target: '/mosquitto/config/mosquitto.conf',
        },
      ])
      .withWaitStrategy(Wait.forLogMessage(/running/))
      .start(),
  ])
  const containers: StartedTestContainer[] = [mongo, redis, broker]
  const mqttUrl = `mqtt://${broker.getHost()}:${broker.getMappedPort(1883)}`

  // Every variable the services read is set here, so a developer's local .env cannot leak in.
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
    JWT_SECRET: 'e2e-jwt-secret',
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    MONGO_INDEX_STRATEGY: 'ensure',
    INTERNAL_API_USER: serviceUrl('user'),
    INTERNAL_API_WORK_CENTER: serviceUrl('work-center'),
    INTERNAL_API_PRODUCTION: serviceUrl('production'),
    INTERNAL_API_TELEMETRY: serviceUrl('telemetry'),
    PLANT_TIMEZONE: 'Europe/Istanbul',
    MQTT_URL: mqttUrl,
    MQTT_USERNAME: MQTT.username,
    MQTT_PASSWORD: MQTT.password,
    SYSTEM_ADMIN_BOOTSTRAP_ENABLED: 'true',
    SYSTEM_ADMIN_EMAIL: ADMIN.email,
    SYSTEM_ADMIN_PASSWORD: ADMIN.password,
  }

  mkdirSync(LOG_DIR, { recursive: true })
  const services = (Object.keys(PORTS) as ServiceName[]).map(name => {
    const entry = resolve(ROOT, name, 'dist/app.js')
    if (!existsSync(entry)) throw new Error(`${entry} is missing; run pnpm build first`)
    const log = createWriteStream(resolve(LOG_DIR, `${name}.log`))
    const child = spawn(process.execPath, [entry], {
      cwd: resolve(ROOT, name),
      env: {
        ...env,
        PORT: String(PORTS[name]),
        MONGO_URI: `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/e2e-${name}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.pipe(log)
    child.stderr?.pipe(log)
    return { name, child }
  })

  const teardown = async () => {
    for (const { child } of services) child.kill()
    await Promise.all(containers.map(container => container.stop()))
  }

  try {
    await Promise.all(services.map(({ name, child }) => waitUntilReady(name, child)))
  } catch (err) {
    await teardown()
    throw err
  }

  const names = Object.keys(PORTS) as ServiceName[]
  project.provide(
    'urls',
    Object.fromEntries(names.map(name => [name, serviceUrl(name)])) as Record<ServiceName, string>,
  )
  project.provide('mqtt', { url: mqttUrl, ...MQTT })
  project.provide('internalToken', INTERNAL_TOKEN)
  project.provide('admin', ADMIN)
  project.provide('logDir', LOG_DIR)

  return teardown
}
