import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// Only the image helper: the package's main entry would load test dependencies e2e does not have
import { composeImage } from '@mes/testing/images'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import type { TestProject } from 'vitest/node'

// Starts MongoDB, Redis and an MQTT broker in containers and the built services as plain Node
// processes, the way they run in production. Tests reach the services only over HTTP and MQTT,
// and ask the control server to stop or start one.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// Every run logs into a folder of its own, so a failed run's logs survive the runs after it.
const LOGS_ROOT = resolve(ROOT, 'e2e/logs')
const KEPT_RUNS = 20

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
    control: string
  }
}

type Service = {
  name: ServiceName
  child: ChildProcess
  logFile: string
  // Settles with the exit code or signal once the process is gone and its log file is complete
  closed: Promise<string>
  // A test stopped it through the control server, so its exit is no crash
  stopped: boolean
}

const serviceUrl = (name: ServiceName) => `http://127.0.0.1:${PORTS[name]}`

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null

async function lastLines(file: string) {
  const log = await readFile(file, 'utf8').catch(() => '')
  return log.trimEnd().split('\n').slice(-30).join('\n')
}

async function pruneOldRuns() {
  const runs = (await readdir(LOGS_ROOT, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  await Promise.all(
    runs
      .slice(0, -KEPT_RUNS)
      .map(run => rm(resolve(LOGS_ROOT, run), { recursive: true, force: true })),
  )
}

function startService(name: ServiceName, runDir: string, env: NodeJS.ProcessEnv): Service {
  const entry = resolve(ROOT, name, 'dist/app.js')
  if (!existsSync(entry)) throw new Error(`${entry} is missing; run pnpm build first`)
  const logFile = resolve(runDir, `${name}.log`)
  // A restarted service adds to the log of its earlier run
  const log = createWriteStream(logFile, { flags: 'a' })
  const child = spawn(process.execPath, [entry], {
    cwd: resolve(ROOT, name),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Both streams write to one file, so neither may end it: the stream that ended first would cut
  // off the other's last lines. The file ends once the process and both streams are closed.
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })
  const closed = new Promise<string>(settle => {
    child.once('close', (code, signal) => {
      log.end(() => settle(signal ? `signal ${signal}` : `code ${code}`))
    })
  })
  return { name, child, logFile, closed, stopped: false }
}

async function waitUntilReady({ name, child, logFile, closed }: Service) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && !hasExited(child)) {
    try {
      const res = await fetch(`${serviceUrl(name)}/health/ready`)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise(r => setTimeout(r, 250))
  }
  const reason = hasExited(child) ? `exited with ${await closed}` : 'was not ready within 60s'
  throw new Error(`${name} ${reason}. Last lines of ${logFile}:\n${await lastLines(logFile)}`)
}

export default async function setup(project: TestProject) {
  const runDir = resolve(LOGS_ROOT, new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(runDir, { recursive: true })
  await pruneOldRuns()
  console.log(`Service logs: ${relative(ROOT, runDir)}`)

  // The repository's broker config, so e2e runs the queue and persistence settings production does.
  // Only the authentication goes: e2e has no password file.
  const brokerConfig = (await readFile(resolve(ROOT, 'infra/mosquitto/mosquitto.conf'), 'utf8'))
    .replace('allow_anonymous false', 'allow_anonymous true')
    .replace(/^password_file .*\r?\n/m, '')

  const [mongo, redis, broker] = await Promise.all([
    new GenericContainer(composeImage('mongodb'))
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start(),
    new GenericContainer(composeImage('redis'))
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer(composeImage('mosquitto'))
      .withExposedPorts(1883)
      .withCopyContentToContainer([
        { content: brokerConfig, target: '/mosquitto/config/mosquitto.conf' },
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

  const names = Object.keys(PORTS) as ServiceName[]
  const launch = (name: ServiceName) =>
    startService(name, runDir, {
      ...env,
      PORT: String(PORTS[name]),
      MONGO_URI: `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/e2e-${name}`,
    })
  // The process each service runs now: a restart through the control server replaces it
  const services = new Map<ServiceName, Service>(names.map(name => [name, launch(name)]))

  let stopping = false
  const reportCrash = (service: Service) => {
    void service.closed.then(exit => {
      if (stopping || service.stopped) return
      console.error(
        `${service.name} exited with ${exit} while the tests ran, see ${service.logFile}`,
      )
    })
  }

  const stopForTest = async (service: Service) => {
    if (hasExited(service.child)) throw new Error(`${service.name} is not running`)
    service.stopped = true
    service.child.kill()
    await service.closed
  }

  // The restarted service listens on the address it had before
  const startForTest = async (previous: Service) => {
    if (!previous.stopped) throw new Error(`${previous.name} was not stopped`)
    const service = launch(previous.name)
    services.set(service.name, service)
    await waitUntilReady(service)
    reportCrash(service)
  }

  // Test files run in other processes and cannot reach the services, so they ask this server on
  // loopback to stop and start them.
  const control = createServer(async (req, res) => {
    const [, name, action] = /^\/services\/([^/]+)\/(start|stop)$/.exec(req.url ?? '') ?? []
    const service = services.get(name as ServiceName)
    if (req.method !== 'POST' || !service) {
      res.writeHead(404).end()
      return
    }
    try {
      if (action === 'stop') await stopForTest(service)
      else await startForTest(service)
      res.writeHead(204).end()
    } catch (err) {
      res.writeHead(500).end(err instanceof Error ? err.message : String(err))
    }
  })

  const stop = async () => {
    stopping = true
    control.close()
    const current = [...services.values()]
    for (const { child } of current) child.kill()
    // The services shut down while MongoDB and Redis are still up, and leave complete logs
    await Promise.all(current.map(service => service.closed))
    await Promise.all(containers.map(container => container.stop()))
  }

  try {
    await Promise.all([...services.values()].map(waitUntilReady))
    await new Promise<void>(listening => control.listen(0, '127.0.0.1', listening))
  } catch (err) {
    await stop()
    throw err
  }

  // From here on a service that exits has crashed: say so at once, and fail the run at teardown.
  for (const service of services.values()) reportCrash(service)

  project.provide(
    'urls',
    Object.fromEntries(names.map(name => [name, serviceUrl(name)])) as Record<ServiceName, string>,
  )
  project.provide('mqtt', { url: mqttUrl, ...MQTT })
  project.provide('internalToken', INTERNAL_TOKEN)
  project.provide('admin', ADMIN)
  project.provide('logDir', runDir)
  project.provide('control', `http://127.0.0.1:${(control.address() as AddressInfo).port}`)

  return async () => {
    const crashed = [...services.values()].filter(
      service => hasExited(service.child) && !service.stopped,
    )
    await stop()
    if (crashed.length === 0) return
    const reports = await Promise.all(
      crashed.map(
        async ({ name, logFile, closed }) =>
          `${name} exited with ${await closed} while the tests ran. Last lines of ${logFile}:\n${await lastLines(logFile)}`,
      ),
    )
    throw new Error(reports.join('\n\n'))
  }
}
