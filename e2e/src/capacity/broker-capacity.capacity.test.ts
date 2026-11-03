import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import mqtt from 'mqtt'
import { describe, expect, inject, it, type ProvidedContext } from 'vitest'
import { Api, loginAsAdmin } from '../support/api.js'
import { startService, stopService } from '../support/services.js'

// Measures what the MQTT broker needs to hold telemetry's queue through an outage: a modelled
// plant publishes while telemetry is down, then telemetry works off the backlog while the plant
// goes on publishing. docs/operations/mqtt-broker-capacity.md holds the method and the results.

const RATE = Number(process.env.CAPACITY_RATE ?? 500)
const OUTAGE_MS = Number(process.env.CAPACITY_OUTAGE_MINUTES ?? 30) * 60_000
const PAYLOAD_BYTES = Number(process.env.CAPACITY_PAYLOAD_BYTES ?? 150)
// The broker keeps telemetry's queue this long after it disconnects. The harness passes the same
// environment on to telemetry, so a longer outage is measured with a longer session.
const SESSION_EXPIRY_MS = Number(process.env.MQTT_SESSION_EXPIRY_SECONDS ?? 86400) * 1000

// Each machine reports whether it runs and 9 counters, every tag read once a second
const NODES = ['run', ...Array.from({ length: 9 }, (_, k) => `counter-${k + 1}`)]
const MACHINES = Array.from(
  { length: Math.floor(RATE / NODES.length) },
  (_, m) => `capacity-m${String(m + 1).padStart(3, '0')}`,
)
// Every machine stops for 3 minutes in every 30, each at its own time: a few run-mode transitions
// per machine per hour
const CYCLE_SECONDS = 1800
const STOPPED_SECONDS = 180

const WARM_UP_SECONDS = 30
const SAMPLE_INTERVAL_MS = 5_000
// Telemetry has caught up with the plant once every counter's latest sample is this recent
const CAUGHT_UP_WITHIN_MS = 5_000

const SYS = {
  count: '$SYS/broker/store/messages/count',
  bytes: '$SYS/broker/store/messages/bytes',
  dropped: '$SYS/broker/publish/messages/dropped',
  heap: '$SYS/broker/heap/current',
}

type Created = { _id: string }
type Sample = { value: number; time: Date }
type Machine = {
  deviceKey: string
  workCenterId: string
  runTagId: string
  counterTagIds: string[]
}

const execFileAsync = promisify(execFile)
const docker = async (...args: string[]) =>
  (await execFileAsync('docker', args, { maxBuffer: 64 * 1024 * 1024 })).stdout

const peak = (values: number[]) => Math.max(...values)

async function inBatches<T, R>(items: T[], size: number, task: (item: T) => Promise<R>) {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(task))))
  }
  return results
}

// ── The plant ───────────────────────────────────────────────────────────────

function reading(machine: number, nodeId: string, second: number) {
  if (nodeId !== 'run') return second
  const phase = Math.floor((machine * CYCLE_SECONDS) / MACHINES.length)
  return (second + phase) % CYCLE_SECONDS < STOPPED_SECONDS ? 0 : 1
}

// The broker's queue ceiling counts payload bytes, so every payload is padded to the same size
function payload(value: number, time: Date) {
  const sample = { value, time: time.toISOString(), pad: '' }
  const padding = PAYLOAD_BYTES - Buffer.byteLength(JSON.stringify(sample))
  if (padding < 0) {
    throw new Error(`CAPACITY_PAYLOAD_BYTES=${PAYLOAD_BYTES} cannot hold ${JSON.stringify(sample)}`)
  }
  return JSON.stringify({ ...sample, pad: 'x'.repeat(padding) })
}

async function createPlant(api: Api): Promise<Machine[]> {
  const tagType = await api.post<Created>('telemetry', '/api/v1/tag-types', {
    name: 'Capacity plant signals',
  })
  const machines: Machine[] = []
  for (const deviceKey of MACHINES) {
    const [run, ...counters] = await Promise.all(
      NODES.map(nodeId =>
        api.post<Created>('telemetry', '/api/v1/tags', {
          name: `${deviceKey} ${nodeId}`,
          tagTypeId: tagType._id,
          behavior: nodeId === 'run' ? 'binary' : 'counter',
          binding: { deviceKey, nodeId },
        }),
      ),
    )
    // Performance decides each machine's run-mode stops
    const workCenter = await api.post<Created>('work-center', '/api/v1/work-centers', {
      code: deviceKey.toUpperCase(),
      name: deviceKey,
      type: 'physical',
      productivityMode: 'count_based',
      tagBindings: { runModeTagId: run._id, productionCounterTagId: counters[0]._id },
    })
    machines.push({
      deviceKey,
      workCenterId: workCenter._id,
      runTagId: run._id,
      counterTagIds: counters.map(c => c._id),
    })
  }
  return machines
}

// Every machine publishes its tags once a second over its own connection at QoS 1, stamped with
// the time it read them. `seconds` holds the time of each second the broker took in full,
// `changes` each machine's run-mode samples that differ from the one before.
async function startPlant() {
  const { url, username, password } = inject('mqtt')
  const clients = await Promise.all(
    MACHINES.map(() => mqtt.connectAsync(url, { username, password })),
  )
  const seconds: Date[] = []
  const changes: Sample[][] = MACHINES.map(() => [])
  let running = true
  const publishing = (async () => {
    const start = Date.now()
    for (let second = 0; running; second++) {
      await sleep(Math.max(0, start + second * 1000 - Date.now()))
      const time = new Date()
      await Promise.all(
        MACHINES.flatMap((deviceKey, machine) =>
          NODES.map(nodeId =>
            clients[machine].publishAsync(
              `devices/${deviceKey}/nodes/${nodeId}`,
              payload(reading(machine, nodeId, second), time),
              { qos: 1 },
            ),
          ),
        ),
      )
      seconds.push(time)
      MACHINES.forEach((_, machine) => {
        const value = reading(machine, 'run', second)
        if (second === 0 || value !== reading(machine, 'run', second - 1)) {
          changes[machine].push({ value, time })
        }
      })
    }
  })()

  let stopped: Promise<void> | null = null
  return {
    seconds,
    changes,
    async published(count: number) {
      while (seconds.length < count) await Promise.race([publishing, sleep(50)])
    },
    stop() {
      running = false
      stopped ??= publishing.finally(() => Promise.all(clients.map(c => c.endAsync())))
      return stopped
    },
  }
}

// ── What the broker, telemetry and Redis report ─────────────────────────────

// Every $SYS value the broker publishes. It publishes a value once per sys_interval (10 s by
// default), and only when it changed.
async function watchBroker() {
  const { url, username, password } = inject('mqtt')
  const client = await mqtt.connectAsync(url, { username, password })
  const readings: Array<{ at: number; topic: string; value: number }> = []
  client.on('message', (topic, message) => {
    readings.push({ at: Date.now(), topic, value: Number(message.toString()) })
  })
  await client.subscribeAsync(Object.values(SYS), { qos: 0 })
  const latest = (topic: string) => readings.filter(r => r.topic === topic).at(-1)?.value ?? 0
  const store = (at: number) => ({
    at,
    count: latest(SYS.count),
    bytes: latest(SYS.bytes),
    heap: latest(SYS.heap),
  })
  return {
    readings,
    // The store as the broker reported it last
    current: () => store(Date.now()),
    // The store as the broker reports it next; the values of one interval arrive together
    async next() {
      const after = Date.now()
      while (Date.now() < after + 60_000) {
        const counted = readings.find(r => r.topic === SYS.count && r.at > after)
        if (counted) {
          await sleep(1000)
          return store(counted.at)
        }
        await sleep(100)
      }
      throw new Error(`the broker published no ${SYS.count} within 60s`)
    },
    stop: () => client.endAsync(),
  }
}

const UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }
const bytesOf = (size: string) => {
  const [, amount, unit] = /^([\d.]+)\s*([A-Za-z]+)$/.exec(size.trim()) ?? []
  return Number(amount) * UNITS[unit]
}

// `docker stats` of the broker container, and the broker process and its cgroup as the container
// sees them: Mosquitto runs as PID 1
async function sampleBroker(id: string) {
  const [stats, inside] = await Promise.all([
    docker('stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', id),
    docker(
      'exec',
      id,
      'sh',
      '-c',
      'grep -E "^Vm(RSS|HWM):" /proc/1/status; echo "cgroup_current $(cat /sys/fs/cgroup/memory.current)"; echo "cgroup_peak $(cat /sys/fs/cgroup/memory.peak)"; grep usage_usec /sys/fs/cgroup/cpu.stat',
    ),
  ])
  const [memoryUsage, cpu] = stats.trim().split('|')
  const field = (name: string) => Number(new RegExp(`^${name}:?\\s+(\\d+)`, 'm').exec(inside)?.[1])
  return {
    at: Date.now(),
    dockerStatsMemoryBytes: bytesOf(memoryUsage.split('/')[0]),
    dockerStatsCpuPercent: Number.parseFloat(cpu),
    rssBytes: field('VmRSS') * 1024,
    peakRssBytes: field('VmHWM') * 1024,
    cgroupMemoryBytes: field('cgroup_current'),
    cgroupPeakBytes: field('cgroup_peak'),
    cpuUsec: field('usage_usec'),
  }
}
type BrokerSample = Awaited<ReturnType<typeof sampleBroker>>

// `docker stats` and the cgroup of a service's container, or null while it is stopped. Its cgroup
// starts again with the container, so peaks are taken over the samples.
async function sampleService(id: string) {
  try {
    const [stats, inside] = await Promise.all([
      docker('stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', id),
      docker(
        'exec',
        id,
        'sh',
        '-c',
        'echo "cgroup_current $(cat /sys/fs/cgroup/memory.current)"; echo "cgroup_peak $(cat /sys/fs/cgroup/memory.peak)"; grep usage_usec /sys/fs/cgroup/cpu.stat',
      ),
    ])
    const [memoryUsage, cpu] = stats.trim().split('|')
    const field = (name: string) => Number(new RegExp(`^${name}\\s+(\\d+)`, 'm').exec(inside)?.[1])
    return {
      at: Date.now(),
      dockerStatsMemoryBytes: bytesOf(memoryUsage.split('/')[0]),
      dockerStatsCpuPercent: Number.parseFloat(cpu),
      cgroupMemoryBytes: field('cgroup_current'),
      cgroupPeakBytes: field('cgroup_peak'),
      cpuUsec: field('usage_usec'),
    }
  } catch {
    return null
  }
}
type ServiceSample = NonNullable<Awaited<ReturnType<typeof sampleService>>>

// Has the broker write its in-memory database now (SIGUSR1) and times the write inside the
// container: Mosquitto writes a new file and renames it over the old one
async function saveBrokerDatabase(id: string) {
  const script = [
    'db=/mosquitto/data/mosquitto.db',
    'before=$(stat -c %i $db 2>/dev/null)',
    "start=$(cut -d' ' -f1 /proc/uptime)",
    'kill -USR1 1',
    'while [ "$(stat -c %i $db 2>/dev/null)" = "$before" ]; do :; done',
    "end=$(cut -d' ' -f1 /proc/uptime)",
    'echo "$start $end $(stat -c %s $db)"',
  ].join('\n')
  const output = await docker('exec', id, 'timeout', '600', 'sh', '-c', script)
  const [start, end, bytes] = output.trim().split(' ').map(Number)
  return { seconds: Number((end - start).toFixed(2)), fileBytes: bytes }
}

async function telemetryRssMiB() {
  try {
    const res = await fetch(`${inject('urls').telemetry}/health`)
    const health = (await res.json()) as { memory?: { rss: number } }
    return health.memory?.rss ?? null
  } catch {
    return null
  }
}

type StreamGroup = {
  name: string
  entriesRead: number | false
  lag: number | false
  pending: number
}
type StreamInfo = { entriesAdded: number; length: number; groups: StreamGroup[] | object }
type StreamsSnapshot = { xack: number; streams: Record<string, StreamInfo> }

// The event streams' counters and the number of XACK calls so far, read in one script so they
// agree with each other
const STREAMS_SNAPSHOT = `
local function field(reply, name)
  for i = 1, #reply, 2 do
    if reply[i] == name then return reply[i + 1] end
  end
end
local streams = {}
local cursor = '0'
repeat
  local page = redis.call('SCAN', cursor, 'MATCH', 'events.*', 'TYPE', 'stream', 'COUNT', 1000)
  cursor = page[1]
  for _, key in ipairs(page[2]) do
    local groups = {}
    for _, group in ipairs(redis.call('XINFO', 'GROUPS', key)) do
      groups[#groups + 1] = {
        name = field(group, 'name'),
        entriesRead = field(group, 'entries-read'),
        lag = field(group, 'lag'),
        pending = field(group, 'pending'),
      }
    end
    local stream = redis.call('XINFO', 'STREAM', key)
    streams[key] = {
      entriesAdded = field(stream, 'entries-added'),
      length = field(stream, 'length'),
      groups = groups,
    }
  end
until cursor == '0'
local xack = redis.call('INFO', 'commandstats'):match('cmdstat_xack:calls=(%d+)')
return cjson.encode({ streams = streams, xack = tonumber(xack) or 0 })
`

async function snapshotStreams(redisId: string): Promise<StreamsSnapshot> {
  return JSON.parse(await docker('exec', redisId, 'redis-cli', 'EVAL', STREAMS_SNAPSHOT, '0'))
}

// cjson writes an empty Lua table as an object
const groupsOf = (stream?: StreamInfo) =>
  Array.isArray(stream?.groups) ? (stream.groups as StreamGroup[]) : []

const readCounter = (stream: StreamInfo, group: StreamGroup) =>
  group.entriesRead !== false
    ? group.entriesRead
    : group.lag !== false
      ? stream.entriesAdded - group.lag
      : 0

// A group's read counter moves one on for every entry it is delivered, and every delivered entry
// is acknowledged once. An entry trimmed before its group read it moves the counter on without an
// acknowledgement.
function trimmedBeforeRead(before: StreamsSnapshot, after: StreamsSnapshot) {
  let advanced = 0
  for (const [key, stream] of Object.entries(after.streams)) {
    for (const group of groupsOf(stream)) {
      const earlier = groupsOf(before.streams[key]).find(g => g.name === group.name)
      advanced += readCounter(stream, group)
      advanced -= earlier ? readCounter(before.streams[key], earlier) : 0
      advanced -= group.pending - (earlier?.pending ?? 0)
    }
  }
  return advanced - (after.xack - before.xack)
}

const performanceGroup = (snapshot: StreamsSnapshot) =>
  groupsOf(snapshot.streams['events.telemetry']).find(g => g.name === 'performance-service')

type Sampled = BrokerSample & {
  phase: string
  telemetryRssMiB: number | null
  performanceLag: number | false | null
  telemetry: ServiceSample | null
  performance: ServiceSample | null
}

// Samples the broker, the telemetry and performance containers and performance's place in
// telemetry's event stream until stopped. A sample that fails is recorded and skipped, so one slow
// docker call does not end a long run.
function startSampling(containerIds: ProvidedContext['containerIds']) {
  const samples: Sampled[] = []
  const failures: Array<{ at: number; error: string }> = []
  let phase = 'warm-up'
  let sampling = true
  const service = (id?: string) => (id ? sampleService(id) : Promise.resolve(null))
  const loop = (async () => {
    while (sampling) {
      const started = Date.now()
      try {
        const [broker, telemetryRss, streams, telemetry, performance] = await Promise.all([
          sampleBroker(containerIds.broker),
          telemetryRssMiB(),
          snapshotStreams(containerIds.redis),
          service(containerIds.telemetry),
          service(containerIds.performance),
        ])
        samples.push({
          ...broker,
          phase,
          telemetryRssMiB: telemetryRss,
          performanceLag: performanceGroup(streams)?.lag ?? null,
          telemetry,
          performance,
        })
      } catch (err) {
        failures.push({ at: started, error: err instanceof Error ? err.message : String(err) })
      }
      await sleep(Math.max(0, started + SAMPLE_INTERVAL_MS - Date.now()))
    }
  })()
  return {
    samples,
    failures,
    enter(next: string) {
      phase = next
    },
    stop() {
      sampling = false
      return loop
    },
  }
}

// CPU use in cores from a cgroup's CPU time: the average over the samples, and the highest over one
// sample interval. A container that started again counts from zero, so that interval is left out.
function cpuCores(samples: Array<{ at: number; cpuUsec: number }>) {
  const intervals = samples
    .slice(1)
    .map((to, i) => ({ from: samples[i], to }))
    .filter(({ from, to }) => to.cpuUsec >= from.cpuUsec)
  const usec = intervals.reduce((sum, { from, to }) => sum + to.cpuUsec - from.cpuUsec, 0)
  const ms = intervals.reduce((sum, { from, to }) => sum + to.at - from.at, 0)
  return {
    average: usec / 1000 / ms,
    peak: peak(
      intervals.map(({ from, to }) => (to.cpuUsec - from.cpuUsec) / 1000 / (to.at - from.at)),
    ),
  }
}

// A service container's memory and CPU over the samples of a phase
function serviceUse(samples: Sampled[], name: 'telemetry' | 'performance', phase: string) {
  const inPhase = samples
    .filter(s => s.phase === phase)
    .map(s => s[name])
    .filter((s): s is ServiceSample => s !== null)
  if (inPhase.length === 0) return null
  return {
    peakDockerStatsBytes: peak(inPhase.map(s => s.dockerStatsMemoryBytes)),
    peakCgroupBytes: peak(inPhase.map(s => s.cgroupPeakBytes)),
    cpuCores: cpuCores(inPhase),
  }
}

// ── Telemetry's history and the service logs ───────────────────────────────

async function latestOccurredAt(tagId: string) {
  const latest = await Api.internal().get<{ occurredAt: string } | null>(
    'telemetry',
    `/internal/v1/historian/${tagId}/latest`,
  )
  return latest ? new Date(latest.occurredAt).getTime() : 0
}

// Resolves once telemetry has stored, for every counter, a sample published at or after the time
// `since` gives when a check starts: the broker delivers each tag's samples in order, so every
// sample published before that time is stored too. Resolves with that time and when it was reached.
async function storedSince(machines: Machine[], since: () => number, deadline: number) {
  const counters = machines.flatMap(m => m.counterTagIds)
  while (Date.now() < deadline) {
    const from = since()
    if ((await latestOccurredAt(counters[0])) >= from) {
      const behind = await inBatches(counters, 10, async id => (await latestOccurredAt(id)) < from)
      if (!behind.includes(true)) return { from, at: Date.now() }
    }
    await sleep(1000)
  }
  throw new Error(
    `telemetry had not stored the samples published by ${new Date(since()).toISOString()} at ${new Date(deadline).toISOString()}`,
  )
}

// The run-mode transitions performance has not decided: a stopped signal it opened no stop at, or a
// running signal that did not close the stop before it
async function undecidedTransitions(api: Api, machines: Machine[], changes: Sample[][]) {
  const stops = await inBatches(machines, 10, machine =>
    api.get<Array<{ startAt: string; endAt: string | null }>>(
      'performance',
      `/api/v1/unplanned-stops?workCenterId=${machine.workCenterId}&limit=100`,
    ),
  )
  return changes.flatMap((published, m) =>
    published
      .filter((change, i) => {
        if (change.value === 0) return !stops[m].some(s => s.startAt === change.time.toISOString())
        // A machine that runs from its first sample has no stop to close
        const stopped = published[i - 1]
        return (
          stopped !== undefined &&
          !stops[m].some(
            s => s.startAt === stopped.time.toISOString() && s.endAt === change.time.toISOString(),
          )
        )
      })
      .map(change => ({ deviceKey: MACHINES[m], ...change })),
  )
}

async function logLines(service: string) {
  const log = await readFile(resolve(inject('logDir'), `${service}.log`), 'utf8')
  return log
    .split('\n')
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line) as Record<string, unknown> & { event?: string; level?: string })
}

const MiB = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`
const count = (n: number) => n.toLocaleString('en-US')
const minutes = (ms: number) =>
  `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`

describe('MQTT broker capacity', () => {
  it(
    'holds telemetry’s queue through an outage at the design load and loses no message',
    async () => {
      if (RATE % NODES.length !== 0) {
        throw new Error(
          `CAPACITY_RATE must be a multiple of ${NODES.length}, the tags of one machine`,
        )
      }
      if (OUTAGE_MS >= SESSION_EXPIRY_MS) {
        throw new Error(
          `CAPACITY_OUTAGE_MINUTES must be shorter than telemetry's session, MQTT_SESSION_EXPIRY_SECONDS=${SESSION_EXPIRY_MS / 1000}`,
        )
      }
      const containerIds = inject('containerIds')
      const reportFile = resolve(inject('logDir'), 'capacity.json')
      // The image and the limits each container ran with
      const containerSettings = Object.fromEntries(
        await Promise.all(
          Object.entries(containerIds).map(async ([name, id]) => [
            name,
            (
              await docker(
                'inspect',
                '--format',
                '{{.Config.Image}}, memory {{.HostConfig.Memory}} bytes, {{.HostConfig.NanoCpus}} nanocpus',
                id as string,
              )
            ).trim(),
          ]),
        ),
      )
      const report: Record<string, unknown> = {
        load: {
          rate: RATE,
          machines: MACHINES.length,
          payloadBytes: PAYLOAD_BYTES,
          outageMs: OUTAGE_MS,
        },
        environment: {
          host: `${os.type()} ${os.release()}, ${os.cpus()[0]?.model} × ${os.cpus().length}, ${os.totalmem()} bytes`,
          node: process.version,
          docker: (await docker('version', '--format', '{{.Server.Version}}')).trim(),
          dockerHost: (
            await docker(
              'info',
              '--format',
              '{{.OperatingSystem}}, {{.KernelVersion}}, {{.NCPU}} CPUs, {{.MemTotal}} bytes',
            )
          ).trim(),
          containers: containerSettings,
        },
      }

      const { api } = await loginAsAdmin()
      const machines = await createPlant(api)
      // Performance maps each run-mode tag to its work center from the work_center.created events
      await sleep(10_000)

      const broker = await watchBroker()
      const sampling = startSampling(containerIds)
      const plant = await startPlant()
      try {
        await plant.published(WARM_UP_SECONDS)
        const before = { store: broker.current(), broker: await sampleBroker(containerIds.broker) }

        await stopService('telemetry')
        const outageStart = Date.now()
        sampling.enter('outage')
        await sleep(outageStart + OUTAGE_MS - Date.now())

        // The queue as the broker reports it next, then saved, before telemetry comes back
        const full = { store: await broker.next(), broker: await sampleBroker(containerIds.broker) }
        const save = await saveBrokerDatabase(containerIds.broker)
        const streamsBefore = await snapshotStreams(containerIds.redis)

        const restartAt = Date.now()
        sampling.enter('drain')
        await startService('telemetry')
        const deadline = restartAt + Math.max(2 * OUTAGE_MS, 10 * 60_000)
        // What queued during the outage is stored once telemetry has reached the restart; the plant
        // publishes on meanwhile, and telemetry has caught up once it is within seconds of it
        const outageBacklogStored = await storedSince(machines, () => restartAt, deadline)
        const caughtUp = await storedSince(
          machines,
          () => plant.seconds[plant.seconds.length - 1].getTime() - CAUGHT_UP_WITHIN_MS,
          deadline,
        )
        sampling.enter('after')
        await sleep(2 * SAMPLE_INTERVAL_MS)
        await plant.stop()

        // Telemetry stores the last second and performance reads every event published for it
        const lastSecond = plant.seconds[plant.seconds.length - 1].getTime()
        await storedSince(machines, () => lastSecond, Date.now() + 60_000)
        let streamsAfter = await snapshotStreams(containerIds.redis)
        for (let waited = 0; waited < 120; waited++) {
          const group = performanceGroup(streamsAfter)
          if (group?.lag === 0 && group.pending === 0) break
          await sleep(1000)
          streamsAfter = await snapshotStreams(containerIds.redis)
        }
        await sampling.stop()

        // Every sample the plant published is in telemetry's history with the machine's own time
        const from = new Date(plant.seconds[0].getTime() - 1).toISOString()
        const to = new Date(lastSecond).toISOString()
        const storedChanges = await inBatches(machines, 10, machine =>
          api.get<Array<{ value: number; occurredAt: string }>>(
            'telemetry',
            `/api/v1/historian/${machine.runTagId}/samples?${new URLSearchParams({ from, to, limit: '250000' })}`,
          ),
        )
        const transitionsLost = plant.changes.flatMap((published, m) =>
          published
            .filter(
              p =>
                !storedChanges[m].some(
                  s => s.value === p.value && s.occurredAt === p.time.toISOString(),
                ),
            )
            .map(p => ({ deviceKey: MACHINES[m], value: p.value, time: p.time.toISOString() })),
        )
        const counterCounts = await inBatches(
          machines.flatMap(m => m.counterTagIds),
          10,
          async id =>
            (
              await api.get<{ count: number }>(
                'telemetry',
                `/api/v1/historian/${id}/count?${new URLSearchParams({ from, to })}`,
              )
            ).count,
        )
        const samplesLost = counterCounts.reduce((lost, n) => lost + plant.seconds.length - n, 0)
        const phaseOf = (time: Date) =>
          time.getTime() < outageStart ? 'warm-up' : time.getTime() < restartAt ? 'outage' : 'drain'
        const undecided = (await undecidedTransitions(api, machines, plant.changes)).map(
          change => ({
            deviceKey: change.deviceKey,
            value: change.value,
            time: change.time.toISOString(),
            phase: phaseOf(change.time),
          }),
        )

        const telemetryLog = await logLines('telemetry')
        const reconnectAt = telemetryLog
          .filter(l => l.event === 'mqtt.connected')
          .map(l => new Date(l.timestamp as string).getTime())
          .find(at => at > restartAt)
        const gapReplays = (await logLines('performance')).filter(
          l => l.event === 'run_mode.sample.gap_replayed',
        )
        const errorLines: Record<string, number> = {}
        for (const service of ['user', 'work-center', 'production', 'telemetry', 'performance']) {
          errorLines[service] = (await logLines(service)).filter(l => l.level === 'error').length
        }

        const samples = sampling.samples
        const queued = full.store.count - before.store.count
        const dropped = broker.readings.filter(r => r.topic === SYS.dropped)
        const telemetryStream = (snapshot: StreamsSnapshot) => snapshot.streams['events.telemetry']
        const results = {
          outageMs: (reconnectAt ?? restartAt) - outageStart,
          fullQueueReadAtMs: full.store.at - outageStart,
          queuedMessages: queued,
          storeBytes: full.store.bytes,
          storeBytesPerQueuedMessage: (full.store.bytes - before.store.bytes) / queued,
          publishedWhileDisconnected:
            plant.seconds.filter(
              t => t.getTime() >= outageStart && t.getTime() < (reconnectAt ?? restartAt),
            ).length * RATE,
          broker: {
            before: before.broker,
            atFullQueue: full.broker,
            peakDockerStatsBytes: peak(samples.map(s => s.dockerStatsMemoryBytes)),
            peakRssBytes: samples[samples.length - 1].peakRssBytes,
            peakCgroupBytes: samples[samples.length - 1].cgroupPeakBytes,
            rssPerQueuedMessage: (full.broker.rssBytes - before.broker.rssBytes) / queued,
            heapPerQueuedMessage: (full.store.heap - before.store.heap) / queued,
            cpuCores: {
              warmUp: cpuCores(samples.filter(s => s.phase === 'warm-up')),
              outage: cpuCores(samples.filter(s => s.phase === 'outage')),
              drain: cpuCores(samples.filter(s => s.phase === 'drain')),
            },
          },
          telemetry: {
            warmUp: serviceUse(samples, 'telemetry', 'warm-up'),
            drain: serviceUse(samples, 'telemetry', 'drain'),
          },
          performance: {
            warmUp: serviceUse(samples, 'performance', 'warm-up'),
            drain: serviceUse(samples, 'performance', 'drain'),
          },
          save,
          outageBacklogStoredMs: outageBacklogStored.at - restartAt,
          caughtUpMs: caughtUp.at - restartAt,
          caughtUpFromReconnectMs: reconnectAt ? caughtUp.at - reconnectAt : null,
          // Every sample published up to the caught-up check was stored from telemetry's reconnect on
          telemetryStoredPerSecond: reconnectAt
            ? (plant.seconds.filter(t => t.getTime() >= outageStart && t.getTime() <= caughtUp.from)
                .length *
                RATE) /
              ((caughtUp.at - reconnectAt) / 1000)
            : null,
          telemetryPeakRssMiB: peak(samples.map(s => s.telemetryRssMiB ?? 0)),
          performancePeakLag: peak(samples.map(s => Number(s.performanceLag || 0))),
          droppedCounter: {
            max: peak(dropped.map(r => r.value)),
            duringDrain: dropped
              .filter(r => r.at >= restartAt && r.at <= caughtUp.at)
              .map(r => r.value),
          },
          droppedLogs: telemetryLog.filter(l => l.event === 'mqtt.broker.messages_dropped').length,
          sessionLostLogs: telemetryLog.filter(l => l.event === 'mqtt.session.lost').length,
          eventStream: {
            added:
              telemetryStream(streamsAfter).entriesAdded -
              telemetryStream(streamsBefore).entriesAdded,
            trimmedBeforeRead: trimmedBeforeRead(streamsBefore, streamsAfter),
            before: streamsBefore,
            after: streamsAfter,
          },
          gapReplays: {
            lines: gapReplays.length,
            replayed: gapReplays.reduce((sum, l) => sum + Number(l.replayed ?? 0), 0),
          },
          transitions: {
            published: plant.changes.flat().length,
            inOutage: plant.changes
              .flat()
              .filter(p => p.time.getTime() >= outageStart && p.time.getTime() < restartAt).length,
            lost: transitionsLost,
            undecidedByPerformance: undecided,
          },
          samples: {
            published: plant.seconds.length * RATE,
            counters: counterCounts.length * plant.seconds.length,
            countersLost: samplesLost,
          },
          errorLines,
        }
        report.results = results

        const brokerCores = results.broker.cpuCores
        const use = (name: string, measured: ReturnType<typeof serviceUse>) =>
          measured
            ? `${name} peak memory ${MiB(measured.peakDockerStatsBytes)} (cgroup ${MiB(measured.peakCgroupBytes)}), CPU ${measured.cpuCores.average.toFixed(3)} cores (peak ${measured.cpuCores.peak.toFixed(3)})`
            : `${name} not sampled`
        console.log(
          [
            '| Rate | Payload | Outage | Queued messages | Broker store | Broker peak memory | Persistence file | Save | Telemetry caught up in | Transitions lost |',
            `|${'---|'.repeat(10)}`,
            `| ${RATE} msg/s | ${PAYLOAD_BYTES} B | ${minutes(results.outageMs)} | ${count(queued)} | ${count(full.store.bytes)} B (${MiB(full.store.bytes)}) | ${MiB(results.broker.peakDockerStatsBytes)} (peak RSS ${MiB(results.broker.peakRssBytes)}) | ${MiB(save.fileBytes)} | ${save.seconds} s | ${minutes(results.caughtUpMs)} | ${transitionsLost.length} of ${results.transitions.published} (${results.transitions.inOutage} in the outage) |`,
            '',
            `counter samples lost: ${count(samplesLost)} of ${count(results.samples.counters)}; messages published: ${count(results.samples.published)}`,
            `queue read ${minutes(results.fullQueueReadAtMs)} into the outage; ${count(results.publishedWhileDisconnected)} published while telemetry was disconnected`,
            `per queued message: store ${results.storeBytesPerQueuedMessage.toFixed(1)} B, broker RSS ${results.broker.rssPerQueuedMessage.toFixed(1)} B, broker heap ${results.broker.heapPerQueuedMessage.toFixed(1)} B`,
            `broker CPU in cores, average (peak over ${SAMPLE_INTERVAL_MS / 1000} s): warm-up ${brokerCores.warmUp.average.toFixed(3)} (${brokerCores.warmUp.peak.toFixed(3)}), outage ${brokerCores.outage.average.toFixed(3)} (${brokerCores.outage.peak.toFixed(3)}), drain ${brokerCores.drain.average.toFixed(3)} (${brokerCores.drain.peak.toFixed(3)})`,
            `during the drain: ${use('telemetry', results.telemetry.drain)}; ${use('performance', results.performance.drain)}`,
            `during the warm-up: ${use('telemetry', results.telemetry.warmUp)}; ${use('performance', results.performance.warmUp)}`,
            `outage backlog stored ${minutes(results.outageBacklogStoredMs)} after the restart; caught up ${results.caughtUpFromReconnectMs === null ? 'n/a' : minutes(results.caughtUpFromReconnectMs)} after telemetry reconnected, storing ${results.telemetryStoredPerSecond?.toFixed(0) ?? 'n/a'} messages/s; telemetry peak RSS ${results.telemetryPeakRssMiB} MiB; performance peak lag ${results.performancePeakLag}`,
            `dropped counter: max ${results.droppedCounter.max}, during the drain [${results.droppedCounter.duringDrain.join(', ')}]; mqtt.broker.messages_dropped lines: ${results.droppedLogs}; mqtt.session.lost lines: ${results.sessionLostLogs}`,
            `events.telemetry: ${count(results.eventStream.added)} entries added from telemetry's restart, ${count(results.eventStream.trimmedBeforeRead)} trimmed before performance read them; ${results.gapReplays.lines} run_mode.sample.gap_replayed lines replaying ${results.gapReplays.replayed} samples`,
            `run-mode transitions performance has not decided: ${undecided.length} ${JSON.stringify(undecided)}`,
            `error lines per service: ${JSON.stringify(errorLines)}; failed samples: ${sampling.failures.length}`,
            `details: ${reportFile}`,
          ].join('\n'),
        )

        expect(transitionsLost).toEqual([])
        expect(samplesLost).toBe(0)
        expect(results.droppedCounter.max).toBe(0)
        expect(results.sessionLostLogs).toBe(0)
        expect(errorLines).toEqual({
          user: 0,
          'work-center': 0,
          production: 0,
          telemetry: 0,
          performance: 0,
        })
      } finally {
        // A failed run keeps what it measured; the run's own error is the one reported
        await Promise.allSettled([plant.stop(), sampling.stop(), broker.stop()])
        Object.assign(report, {
          timeline: sampling.samples,
          samplingFailures: sampling.failures,
          sys: broker.readings,
        })
        await writeFile(reportFile, JSON.stringify(report, null, 2))
      }
    },
    OUTAGE_MS * 3 + 20 * 60_000,
  )
})
