import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
// Only the image helper: the package's main entry would load test dependencies e2e does not have
import { composeImage, MONGO_ENVIRONMENT } from '@mes/testing/images'
import { GenericContainer, Network, type StartedTestContainer, Wait } from 'testcontainers'
import type { TestProject } from 'vitest/node'

// Starts MongoDB, Redis and an MQTT broker in containers and the built services as plain Node
// processes, the way they run in production. Tests reach the services only over HTTP and MQTT,
// and ask the control server to stop or start one. The capacity measurement runs some services as
// containers built from their Dockerfiles instead, under their docker-compose.yml limits.

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
    containerIds: { broker: string; redis: string } & Partial<Record<ServiceName, string>>
    // The capacity measurement's config sets these. Without a queue ceiling the broker measures
    // what the queue needs; with its limits and the services in containers, the run measures the
    // deployment.
    brokerQueueCeiling?: boolean
    brokerLimits?: boolean
    containerServices?: ServiceName[]
  }
}

type Service = {
  name: ServiceName
  logFile: string
  // Settles with the exit code or signal once the service has stopped and its log file is complete
  closed: Promise<string>
  running: () => boolean
  stop: () => void
  // A test stopped it through the control server, so its exit is no crash
  stopped: boolean
}

const run = promisify(execFile)

const serviceUrl = (name: ServiceName) => `http://127.0.0.1:${PORTS[name]}`

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null

async function lastLines(file: string) {
  const log = await readFile(file, 'utf8').catch(() => '')
  return log.trimEnd().split('\n').slice(-30).join('\n')
}

// The services log JSON lines in production mode
async function errorLines(file: string) {
  const log = await readFile(file, 'utf8')
  return log.split('\n').filter(line => /"level":\s*"error"/.test(line))
}

// A line that is gone or written differently fails the run at once, so e2e never runs a broker
// without its changes
function replaceLine(config: string, line: RegExp, replacement: string) {
  if (!line.test(config)) {
    throw new Error(`infra/mosquitto/mosquitto.conf has no line matching ${line}`)
  }
  return config.replace(line, replacement)
}

// The CPU and memory limits docker-compose.yml gives a service
function composeLimits(service: string) {
  const lines = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8').split(/\r?\n/)
  const start = lines.indexOf(`  ${service}:`)
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line))
  const block = lines.slice(start, end < 0 ? undefined : end).join('\n')
  const cpus = /^ {10}cpus: '([\d.]+)'$/m.exec(block)?.[1]
  const memory = /^ {10}memory: (\d+)M$/m.exec(block)?.[1]
  if (start < 0 || !cpus || !memory) {
    throw new Error(`docker-compose.yml gives ${service} no cpus and memory limits`)
  }
  // testcontainers takes memory in GiB, and compose's M is MiB
  return { cpu: Number(cpus), memory: Number(memory) / 1024 }
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

function startProcess(name: ServiceName, runDir: string, env: NodeJS.ProcessEnv): Service {
  const entry = resolve(ROOT, name, 'dist/app.js')
  if (!existsSync(entry)) throw new Error(`${entry} is missing; run pnpm build first`)
  const logFile = resolve(runDir, `${name}.log`)
  // A restarted service adds to the log of its earlier run
  const log = createWriteStream(logFile, { flags: 'a' })
  // The service works in a folder of the run's own, as it works in /app in its image. In production
  // mode dotenv reads .env from the working folder, and the service's own folder holds the
  // developer's. Files the service writes, such as uploads, stay with the run as well.
  const workDir = resolve(runDir, name)
  mkdirSync(workDir, { recursive: true })
  const child = spawn(process.execPath, [entry], {
    cwd: workDir,
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
  return {
    name,
    logFile,
    closed,
    stopped: false,
    running: () => !hasExited(child),
    stop: () => child.kill(),
  }
}

// Follows a started container's log into the service's log file until the container stops.
// `since` leaves out what an earlier run of the same container already wrote there.
function followContainer(name: ServiceName, id: string, runDir: string, since?: string): Service {
  const logFile = resolve(runDir, `${name}.log`)
  const log = createWriteStream(logFile, { flags: 'a' })
  const follower = spawn('docker', ['logs', '--follow', ...(since ? ['--since', since] : []), id], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  follower.stdout.pipe(log, { end: false })
  follower.stderr.pipe(log, { end: false })
  const followed = new Promise<void>(done => follower.once('close', () => done()))
  let running = true
  const closed = (async () => {
    await run('docker', ['wait', id]).catch(() => undefined)
    running = false
    const state = await run('docker', [
      'inspect',
      '--format',
      '{{.State.ExitCode}} {{.State.OOMKilled}}',
      id,
    ]).catch(() => ({ stdout: 'unknown false' }))
    await followed
    await new Promise<void>(done => log.end(done))
    const [code, oomKilled] = state.stdout.trim().split(' ')
    return `code ${code}${oomKilled === 'true' ? ', killed for running out of memory' : ''}`
  })()
  return {
    name,
    logFile,
    closed,
    stopped: false,
    running: () => running,
    // Docker sends SIGTERM and kills the container if it has not stopped within 10 s
    stop: () => void run('docker', ['stop', id]).catch(() => undefined),
  }
}

// The service's image, built from its Dockerfile as the deployment builds it
async function buildImage(name: ServiceName, runDir: string) {
  const tag = `edmes-e2e-${name}`
  const log = createWriteStream(resolve(runDir, `${name}.image-build.log`))
  const build = spawn('docker', ['build', '-f', `${name}/Dockerfile`, '-t', tag, '.'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  build.stdout.pipe(log, { end: false })
  build.stderr.pipe(log, { end: false })
  const code = await new Promise<number | null>(done => build.once('close', done))
  await new Promise<void>(done => log.end(done))
  if (code !== 0) throw new Error(`docker build of ${name} failed, see ${name}.image-build.log`)
  return tag
}

async function waitUntilReady({ name, logFile, closed, running }: Service) {
  const deadline = Date.now() + 60_000
  let lastCheck = 'none'
  while (Date.now() < deadline && running()) {
    try {
      const res = await fetch(`${serviceUrl(name)}/health/ready`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (res.ok) return
      lastCheck = `${res.status} ${(await res.text()).slice(0, 200)}`
    } catch (err) {
      // fetch throws "fetch failed" and carries the refused or dropped connection as its cause
      lastCheck = String(err instanceof Error && err.cause ? err.cause : err)
    }
    await new Promise(r => setTimeout(r, 250))
  }
  const reason = running()
    ? `was not ready within 60s, last check: ${lastCheck}`
    : `exited with ${await closed}`
  throw new Error(`${name} ${reason}. Last lines of ${logFile}:\n${await lastLines(logFile)}`)
}

export default async function setup(project: TestProject) {
  const runDir = resolve(LOGS_ROOT, new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(runDir, { recursive: true })
  await pruneOldRuns()
  console.log(`Service logs: ${relative(ROOT, runDir)}`)

  const options = project.getProvidedContext()
  const inContainers = new Set(options.containerServices ?? [])

  // The repository's broker config, so e2e runs the queue and persistence settings production does.
  // Only the authentication goes: e2e has no password file.
  const repositoryBrokerConfig = await readFile(
    resolve(ROOT, 'infra/mosquitto/mosquitto.conf'),
    'utf8',
  )
  const authenticatedBrokerConfig = replaceLine(
    replaceLine(repositoryBrokerConfig, /^allow_anonymous false$/m, 'allow_anonymous true'),
    /^password_file .*$/m,
    '',
  )
  const brokerConfig =
    options.brokerQueueCeiling === false
      ? replaceLine(authenticatedBrokerConfig, /^max_queued_bytes \d+$/m, '')
      : authenticatedBrokerConfig

  const images = new Map(
    await Promise.all(
      [...inContainers].map(async name => [name, await buildImage(name, runDir)] as const),
    ),
  )
  // Services in containers reach MongoDB, Redis, the broker and each other by name, and the
  // services on the host through host.docker.internal
  const network = await new Network().start()
  const broker = new GenericContainer(composeImage('mosquitto'))
    .withNetwork(network)
    .withNetworkAliases('mosquitto')
    .withExposedPorts(1883)
    .withCopyContentToContainer([
      { content: brokerConfig, target: '/mosquitto/config/mosquitto.conf' },
    ])
    .withWaitStrategy(Wait.forLogMessage(/running/))
  const [mongo, redis, startedBroker] = await Promise.all([
    new GenericContainer(composeImage('mongodb'))
      .withEnvironment(MONGO_ENVIRONMENT)
      .withNetwork(network)
      .withNetworkAliases('mongodb')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start(),
    new GenericContainer(composeImage('redis'))
      .withNetwork(network)
      .withNetworkAliases('redis')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    (options.brokerLimits ? broker.withResourcesQuota(composeLimits('mosquitto')) : broker).start(),
  ])
  const containers: StartedTestContainer[] = [mongo, redis, startedBroker]
  const mqttUrl = `mqtt://${startedBroker.getHost()}:${startedBroker.getMappedPort(1883)}`

  // The services' settings come from here, or are their defaults: a service process works in a
  // folder without a .env (see startProcess), and an image holds none, so a developer's local .env
  // cannot leak in.
  const shared = {
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
    JWT_SECRET: 'e2e-jwt-secret',
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    MONGO_INDEX_STRATEGY: 'ensure',
    PLANT_TIMEZONE: 'Europe/Istanbul',
    MQTT_USERNAME: MQTT.username,
    MQTT_PASSWORD: MQTT.password,
    SYSTEM_ADMIN_BOOTSTRAP_ENABLED: 'true',
    SYSTEM_ADMIN_EMAIL: ADMIN.email,
    SYSTEM_ADMIN_PASSWORD: ADMIN.password,
  }
  const env = {
    ...process.env,
    ...shared,
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    INTERNAL_API_USER: serviceUrl('user'),
    INTERNAL_API_WORK_CENTER: serviceUrl('work-center'),
    INTERNAL_API_PRODUCTION: serviceUrl('production'),
    INTERNAL_API_TELEMETRY: serviceUrl('telemetry'),
    MQTT_URL: mqttUrl,
  }
  // A container gets only what the services read, with the MQTT settings a run may change
  const containerUrl = (name: ServiceName) =>
    inContainers.has(name)
      ? `http://${name}:${PORTS[name]}`
      : `http://host.docker.internal:${PORTS[name]}`
  const containerEnv = (name: ServiceName) => ({
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[0].startsWith('MQTT_') && entry[1] !== undefined,
      ),
    ),
    ...shared,
    PORT: String(PORTS[name]),
    MONGO_URI: `mongodb://mongodb:27017/e2e-${name}`,
    REDIS_URL: 'redis://redis:6379',
    INTERNAL_API_USER: containerUrl('user'),
    INTERNAL_API_WORK_CENTER: containerUrl('work-center'),
    INTERNAL_API_PRODUCTION: containerUrl('production'),
    INTERNAL_API_TELEMETRY: containerUrl('telemetry'),
    MQTT_URL: 'mqtt://mosquitto:1883',
  })

  const names = Object.keys(PORTS) as ServiceName[]
  const serviceContainers = new Map<ServiceName, StartedTestContainer>()
  const launchProcess = (name: ServiceName) =>
    startProcess(name, runDir, {
      ...env,
      PORT: String(PORTS[name]),
      MONGO_URI: `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/e2e-${name}`,
    })
  const launchContainer = async (name: ServiceName) => {
    const container = await new GenericContainer(images.get(name) as string)
      .withNetwork(network)
      .withNetworkAliases(name)
      .withEnvironment(containerEnv(name))
      .withExposedPorts({ container: PORTS[name], host: PORTS[name] })
      .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
      .withResourcesQuota(composeLimits(name))
      .withWaitStrategy(Wait.forListeningPorts())
      .start()
    serviceContainers.set(name, container)
    containers.unshift(container)
    return followContainer(name, container.getId(), runDir)
  }
  // The process or container each service runs now: a restart through the control server
  // replaces the process, or starts the same container again
  const services = new Map<ServiceName, Service>(
    await Promise.all(
      names.map(
        async name =>
          [
            name,
            inContainers.has(name) ? await launchContainer(name) : launchProcess(name),
          ] as const,
      ),
    ),
  )
  // Every process or container run of the services, restarts included, so teardown sees how each
  // one ended
  const started = [...services.values()]

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
    if (!service.running()) throw new Error(`${service.name} is not running`)
    service.stopped = true
    service.stop()
    await service.closed
  }

  // The restarted service listens on the address it had before
  const startForTest = async (previous: Service) => {
    if (!previous.stopped) throw new Error(`${previous.name} was not stopped`)
    const container = serviceContainers.get(previous.name)
    let service: Service
    if (container) {
      const since = new Date().toISOString()
      await run('docker', ['start', container.getId()])
      service = followContainer(previous.name, container.getId(), runDir, since)
    } else {
      service = launchProcess(previous.name)
    }
    services.set(service.name, service)
    started.push(service)
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
    for (const service of current) service.stop()
    // The services shut down while MongoDB and Redis are still up, and leave complete logs
    await Promise.all(current.map(service => service.closed))
    await Promise.all(containers.map(container => container.stop()))
    await network.stop()
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
  project.provide('containerIds', {
    broker: startedBroker.getId(),
    redis: redis.getId(),
    ...Object.fromEntries([...serviceContainers].map(([name, c]) => [name, c.getId()])),
  })

  // A service that exited on its own, or logged an error at any time from its start to its shutdown,
  // fails the run. An error line is often the only trace of a failure no request saw, such as a
  // crashed stream consumer or a failed startup job.
  return async () => {
    try {
      const crashed = [...services.values()].filter(
        service => !service.running() && !service.stopped,
      )
      await stop()
      const exitReports = await Promise.all(
        started.map(async service => {
          const exit = await service.closed
          // A stop ends the process by SIGTERM, or with code 0 once it has shut down. Any other end
          // came from the service itself, even one that came as it was being stopped.
          const stoppedCleanly = exit === 'code 0' || exit === 'signal SIGTERM'
          if (stoppedCleanly && !crashed.includes(service)) return []
          const when = crashed.includes(service)
            ? 'while the tests ran'
            : 'by the end of the run, which no stop ends with'
          return [
            `${service.name} exited with ${exit} ${when}. Last lines of ${service.logFile}:\n${await lastLines(service.logFile)}`,
          ]
        }),
      )
      const errorReports = await Promise.all(
        names.map(async name => {
          const logFile = resolve(runDir, `${name}.log`)
          const errors = await errorLines(logFile)
          return errors.length === 0
            ? []
            : [`${name} logged ${errors.length} error lines in ${logFile}:\n${errors.join('\n')}`]
        }),
      )
      const reports = [...exitReports.flat(), ...errorReports.flat()]
      if (reports.length > 0) throw new Error(reports.join('\n\n'))
    } catch (err) {
      // Vitest prints an error a global teardown throws, yet exits 0 for it
      process.exitCode = 1
      throw err
    }
  }
}
