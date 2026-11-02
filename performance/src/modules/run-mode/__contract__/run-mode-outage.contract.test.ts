import '../../../test/contract-setup.js'

import { once } from 'node:events'
import type { Server } from 'node:http'
import express, { type Request, type Response } from 'express'
import { Types } from 'mongoose'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'
import { __test__ as subscribers } from '../../../jobs/subscribers.js'
import { logger } from '../../../lib/logger.js'
import { closeRedis, initRedis, redisClient } from '../../../lib/redis.js'
import { testRedis } from '../../../test/contract-setup.js'
import { PlannedStop } from '../../planned-stop/planned-stop.model.js'
import * as policyService from '../../policy/policy.service.js'
import { bootstrapSystemReasons } from '../../reason/reason.bootstrap.js'
import { Reason } from '../../reason/reason.model.js'
import { UnplannedStop } from '../../unplanned-stop/unplanned-stop.model.js'
import * as unplannedStopService from '../../unplanned-stop/unplanned-stop.service.js'
import {
  deleteDecision,
  type PendingDecision,
  readDecision,
  retryDelayMs,
  writeDecision,
} from '../run-mode.decisions.js'
import { handleRunModeSample } from '../run-mode.processor.js'
import { RunModeProcessingState } from '../run-mode-processing-state.model.js'

// ── Stub servers: each endpoint answers, fails with 500 or never answers ─────

type StubMode = 'answer' | 'fail' | 'hang'

interface StubEndpoint {
  mode: StubMode
  // null answers 404, as the services do for an unknown work center or tag
  answer: (req: Request) => unknown
}

type Endpoint = 'workCenter' | 'runModeMonitors' | 'latest' | 'stateDurations'

interface StoredSample {
  occurredAt: Date
  value: number
}

// The samples telemetry stored per tag, oldest first: a value only when it changed
const telemetryHistory = new Map<string, StoredSample[]>()

// state-durations as telemetry computes it (binary.calc.ts, with the validator's default limit of
// 500): the samples in [after ?? from, to), the state before them as the baseline, and while hasMore
// the segment still in progress left out, for the next page to start at nextCursor
function stateDurations(req: Request) {
  const from = new Date(String(req.query.from))
  const to = new Date(String(req.query.to))
  const after = req.query.after === undefined ? undefined : new Date(String(req.query.after))
  const limit = req.query.limit === undefined ? 500 : Math.max(2, Number(req.query.limit))
  const windowStart = after && after.getTime() > from.getTime() ? after : from
  const samples = telemetryHistory.get(String(req.params.tagId)) ?? []
  const baseline = samples.filter(s => s.occurredAt.getTime() < windowStart.getTime()).at(-1)
  const inWindow = samples.filter(
    s => s.occurredAt.getTime() >= windowStart.getTime() && s.occurredAt.getTime() < to.getTime(),
  )
  const hasMore = inWindow.length > limit
  const docs = hasMore ? inWindow.slice(0, limit) : inWindow
  if (!baseline && docs.length === 0) return { segments: [], hasMore, nextCursor: null }

  const segments: { state: number; start: Date; end: Date; durationMs: number }[] = []
  let state = baseline ? baseline.value : docs[0].value
  let start = baseline ? windowStart : docs[0].occurredAt
  for (const doc of baseline ? docs : docs.slice(1)) {
    if (doc.value === state) continue
    const durationMs = doc.occurredAt.getTime() - start.getTime()
    if (durationMs > 0) segments.push({ state, start, end: doc.occurredAt, durationMs })
    state = doc.value
    start = doc.occurredAt
  }
  const lastMs = to.getTime() - start.getTime()
  if (!hasMore && lastMs > 0) segments.push({ state, start, end: to, durationMs: lastMs })
  return { segments, hasMore, nextCursor: hasMore ? docs[docs.length - 1].occurredAt : null }
}

let stubs: Record<Endpoint, StubEndpoint>
// The requests each endpoint received, as their path parameters and query
let received: Record<Endpoint, Record<string, unknown>[]>

function resetStubs(): void {
  stubs = {
    workCenter: { mode: 'answer', answer: () => null },
    runModeMonitors: { mode: 'answer', answer: () => [] },
    latest: { mode: 'answer', answer: () => null },
    stateDurations: { mode: 'answer', answer: stateDurations },
  }
  received = { workCenter: [], runModeMonitors: [], latest: [], stateDurations: [] }
  telemetryHistory.clear()
}

// Requests held by a hanging endpoint, released after each test
const held = new Set<Response>()

function serve(endpoint: Endpoint) {
  return (req: Request, res: Response): void => {
    received[endpoint].push({ ...req.params, ...req.query })
    const { mode, answer } = stubs[endpoint]
    if (mode === 'hang') {
      held.add(res)
      return
    }
    if (mode === 'fail') {
      res.status(500).json({ error: { code: 'error.internal', message: 'Internal error' } })
      return
    }
    const data = answer(req)
    if (data === null) {
      res.status(404).json({ error: { code: 'error.not_found', message: 'Not found' } })
      return
    }
    res.json({ data })
  }
}

function listen(app: express.Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, err => (err ? reject(err) : resolve(server)))
  })
}

const servers: Server[] = []

beforeAll(async () => {
  const workCenter = express()
  // Ahead of /:id, which would take the path for an id
  workCenter.get('/internal/v1/work-centers/run-mode-monitors', serve('runModeMonitors'))
  workCenter.get('/internal/v1/work-centers/:id', serve('workCenter'))
  const telemetry = express()
  telemetry.get('/internal/v1/historian/:tagId/latest', serve('latest'))
  telemetry.get('/internal/v1/historian/:tagId/state-durations', serve('stateDurations'))
  servers.push(await listen(workCenter, 19902), await listen(telemetry, 19904))
  // Pending decisions live in Redis behind the service's own clients, as in production
  await initRedis()
}, 30_000)

afterAll(async () => {
  for (const server of servers) server.closeAllConnections()
  await Promise.all(
    servers.map(s => new Promise<void>((res, rej) => s.close(e => (e ? rej(e) : res())))),
  )
  await closeRedis()
})

beforeEach(async () => {
  resetStubs()
  subscribers.runModeTagToWorkCenter.clear()
  // contract-setup wipes MongoDB and flushes Redis after every test
  await bootstrapSystemReasons()
})

afterEach(() => {
  for (const res of held) res.destroy()
  held.clear()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const userId = new Types.ObjectId().toString()

// A clock time of one day in UTC, as the scenarios write it
const at = (time: string): Date => new Date(`2026-06-15T${time}.000Z`)

interface Machine {
  workCenterId: string
  runModeTagId: string
}

async function machineWithDebounce(debounceMs: number): Promise<Machine> {
  const workCenterId = new Types.ObjectId().toString()
  await policyService.upsertForWorkCenter(workCenterId, { runModeDebounceMs: debounceMs }, userId)
  return { workCenterId, runModeTagId: new Types.ObjectId().toString() }
}

// A run-mode value stamped with the machine's own time, as the telemetry subscriber passes it on
function signal(machine: Machine, value: number, time: string): Promise<void> {
  return handleRunModeSample({ ...machine, value, occurredAt: at(time) })
}

// What telemetry publishes as tag.value.recorded
interface RecordedValue {
  tagId: string
  behavior: string
  value: number
  occurredAt: string
  previousOccurredAt: string | null
}

// Telemetry stores the machine's run-mode value and publishes it with the time of the sample it
// stored before for the tag
function recorded(machine: Machine, value: number, time: string): RecordedValue {
  const history = telemetryHistory.get(machine.runModeTagId) ?? []
  const previous = history.at(-1)
  history.push({ occurredAt: at(time), value })
  telemetryHistory.set(machine.runModeTagId, history)
  return {
    tagId: machine.runModeTagId,
    behavior: 'binary',
    value,
    occurredAt: at(time).toISOString(),
    previousOccurredAt: previous ? previous.occurredAt.toISOString() : null,
  }
}

// The stream hands a recorded value to performance's subscriber, which knows the machine's tag
function deliver(machine: Machine, event: RecordedValue): Promise<void> {
  subscribers.runModeTagToWorkCenter.set(machine.runModeTagId, machine.workCenterId)
  return subscribers.streams['events.telemetry']['tag.value.recorded'](event)
}

async function stopsOf(machine: Machine) {
  const stops = await UnplannedStop.find({ workCenterId: new Types.ObjectId(machine.workCenterId) })
    .sort({ startAt: 1 })
    .lean()
  return stops.map(({ source, startAt, endAt }) => ({ source, startAt, endAt }))
}

const runModeStop = (from: string, to: string) => ({
  source: 'run_mode',
  startAt: at(from),
  endAt: at(to),
})

// Redis read directly, under the key prefix the tick scans
const candidateKey = (machine: Machine): string =>
  `performance:runmode:candidate:${machine.workCenterId}:${machine.runModeTagId}`

function candidateKeys(machine: Machine): Promise<string[]> {
  return testRedis.keys(`performance:runmode:candidate:${machine.workCenterId}:*`)
}

async function storedCandidate(machine: Machine): Promise<PendingDecision | null> {
  const raw = await testRedis.get(candidateKey(machine))
  return raw === null ? null : (JSON.parse(raw) as PendingDecision)
}

// The candidate rule 1 writes for a stop at the given time, D = 60 s
const candidateSince = (time: string): PendingDecision => ({
  kind: 'debounce',
  since: at(time).toISOString(),
  debounceMs: 60_000,
  attempts: 0,
  nextAttemptAt: null,
})

function seedReason(usage: 'planned_stop' | 'unplanned_stop') {
  const code = `R-${new Types.ObjectId().toString()}`
  return Reason.create({
    code,
    name: code,
    usages: [usage],
    canStartManually: true,
    canBeScheduled: false,
    canConvertFromUnplanned: false,
    isSystemDefault: false,
    isActive: true,
    affectsOee: true,
    createdBy: new Types.ObjectId(userId),
  })
}

const cursorOf = (machine: Machine) =>
  RunModeProcessingState.findOne({ workCenterId: new Types.ObjectId(machine.workCenterId) }).lean()

// Redis answers one command with an error while it keeps serving the rest: the user the service
// connects as loses the command until fn is done
async function whileRedisRefuses<T>(command: string, fn: () => Promise<T>): Promise<T> {
  await testRedis.call('ACL', 'SETUSER', 'default', `-${command}`)
  try {
    return await fn()
  } finally {
    await testRedis.call('ACL', 'SETUSER', 'default', `+${command}`)
  }
}

// The service's own cache client loses its connection, as when Redis goes away, and gets it back
async function whileRedisIsUnreachable<T>(fn: () => Promise<T>): Promise<T> {
  const ended = once(redisClient, 'end')
  redisClient.disconnect()
  await ended
  try {
    return await fn()
  } finally {
    const ready = once(redisClient, 'ready')
    await redisClient.connect()
    await ready
  }
}

// ── Scenario 2: the running signal decides a pending candidate ───────────────

describe('A running signal decides a pending candidate on the machine times (scenario 2)', () => {
  it('records the stop when the running signal shows it outlasted the debounce', async () => {
    const machine = await machineWithDebounce(60_000)
    stubs.latest.mode = 'fail'
    stubs.stateDurations.mode = 'fail'

    await signal(machine, 0, '10:00:00')
    await signal(machine, 1, '10:05:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('records nothing when the running signal shows the stop was shorter', async () => {
    const machine = await machineWithDebounce(60_000)

    await signal(machine, 0, '10:00:00')
    await signal(machine, 1, '10:00:20')

    expect(await stopsOf(machine)).toEqual([])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('records the stop when the machine stood exactly the debounce', async () => {
    const machine = await machineWithDebounce(60_000)

    await signal(machine, 0, '10:00:00')
    await signal(machine, 1, '10:01:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:01:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('records nothing when a planned stop covers the first stop time', async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 0, '10:00:00')
    // Entered after the stopped signal, running since 09:55; it covers T0 but not T1
    const reason = await seedReason('planned_stop')
    await PlannedStop.create({
      workCenterId: new Types.ObjectId(machine.workCenterId),
      reasonId: reason._id,
      plannedOwnerId: new Types.ObjectId(userId),
      source: 'manual',
      startMode: 'manual',
      status: 'active',
      plannedStartAt: at('09:55:00'),
      plannedEndAt: at('10:04:00'),
      actualStartAt: at('09:55:00'),
      createdBy: new Types.ObjectId(userId),
    })

    await signal(machine, 1, '10:05:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('the stop that was already open at T0 closes at T1 when the running signal arrives', async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 0, '10:00:00')
    // The tick opened the stop at T0 and has not deleted the candidate yet
    const open = await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:00:00'))

    await signal(machine, 1, '10:05:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect((await UnplannedStop.findById(open._id).lean())?.endAt).toEqual(at('10:05:00'))
    expect(await candidateKeys(machine)).toEqual([])
  })
})

// ── Scenario 3: a burst of signals after an outage ───────────────────────────

describe('A burst of signals after an outage (scenario 3)', () => {
  it('records only the stop that outlasted the debounce in a burst', async () => {
    const machine = await machineWithDebounce(60_000)

    await signal(machine, 0, '10:00:00')
    await signal(machine, 1, '10:00:20')
    await signal(machine, 0, '10:00:40')
    await signal(machine, 1, '10:03:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:40', '10:03:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })
})

// ── Scenario 6: the running signal arrives late for a stop already open ──────

describe('A late running signal for a stop already open (scenario 6)', () => {
  it('deletes an untouched stop the late running signal shows was too short', async () => {
    const machine = await machineWithDebounce(60_000)
    await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:00:00'))

    await signal(machine, 1, '10:00:20')

    expect(await stopsOf(machine)).toEqual([])
  })

  it('a short run-mode stop a user has changed is closed and kept when the late running signal arrives', async () => {
    const machine = await machineWithDebounce(60_000)
    const open = await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:00:00'))
    const reason = await seedReason('unplanned_stop')
    await unplannedStopService.patch(
      open._id.toString(),
      { reasonId: reason._id.toString() },
      userId,
    )

    await signal(machine, 1, '10:00:20')

    const stops = await UnplannedStop.find({
      workCenterId: new Types.ObjectId(machine.workCenterId),
    }).lean()
    expect(stops).toHaveLength(1)
    expect(stops[0]._id.toString()).toBe(open._id.toString())
    expect(stops[0].endAt).toEqual(at('10:00:20'))
    expect(stops[0].reasonId?.toString()).toBe(reason._id.toString())
    expect(stops[0].updatedBy?.toString()).toBe(userId)
  })
})

// ── Rule 2: a late running signal never ends a stop that started after it ────

describe('A late running signal never ends a stop that started after it (rule 2)', () => {
  it("leaves an operator's manual stop opened after the signal open", async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 0, '10:00:00')
    // The operator opens a stop at 10:30, before the machine's 10:25 running signal arrives
    const manual = await unplannedStopService.createManual(
      { workCenterId: machine.workCenterId, startAt: at('10:30:00') },
      userId,
    )

    await signal(machine, 1, '10:25:00')

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:00:00', '10:25:00'),
      { source: 'manual', startAt: at('10:30:00'), endAt: null },
    ])
    expect((await UnplannedStop.findById(manual._id).lean())?.endAt).toBeNull()
  })

  it('leaves an untouched run-mode stop opened after the signal open', async () => {
    const machine = await machineWithDebounce(60_000)
    // A planned stop that closed at 10:30 opened it, before the machine's 10:25 running signal arrived
    const open = await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:30:00'))

    await signal(machine, 1, '10:25:00')

    expect(await stopsOf(machine)).toEqual([
      { source: 'run_mode', startAt: at('10:30:00'), endAt: null },
    ])
    expect((await UnplannedStop.findById(open._id).lean())?.endAt).toBeNull()
  })
})

// ── Review focus 4: the same stopped sample delivered twice ──────────────────

describe('The same stopped sample delivered twice (review focus 4)', () => {
  it('keeps one candidate with its first stop time when a stopped sample arrives twice', async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 1, '09:00:00')
    await signal(machine, 0, '10:00:00')
    expect(await storedCandidate(machine)).toEqual({
      kind: 'debounce',
      since: '2026-06-15T10:00:00.000Z',
      debounceMs: 60_000,
      attempts: 0,
      nextAttemptAt: null,
    })
    // The tick has been retrying since, and the process crashed before it stored the cursor for
    // the 10:00 sample, so the stream delivers that sample again
    const retrying: PendingDecision = {
      kind: 'debounce',
      since: '2026-06-15T10:00:00.000Z',
      debounceMs: 60_000,
      attempts: 2,
      nextAttemptAt: '2026-06-15T10:01:03.000Z',
    }
    await writeDecision(machine.workCenterId, machine.runModeTagId, retrying)
    await RunModeProcessingState.updateOne(
      { workCenterId: new Types.ObjectId(machine.workCenterId) },
      { $set: { lastProcessedOccurredAt: at('09:00:00'), lastProcessedValue: 1 } },
    )

    await signal(machine, 0, '10:00:00')

    expect(await candidateKeys(machine)).toEqual([candidateKey(machine)])
    expect(await storedCandidate(machine)).toEqual(retrying)
    expect(await stopsOf(machine)).toEqual([])
  })
})

// ── Review focus 5: the debounce changes while a candidate is pending ────────

describe('The debounce changes while a candidate is pending (review focus 5)', () => {
  it('keeps the debounce a candidate started with when the policy changes', async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 0, '10:00:00')
    // A debounce of 5 minutes needs a micro stop threshold above it
    await policyService.upsertForWorkCenter(
      machine.workCenterId,
      { runModeDebounceMs: 300_000, microStopThresholdMs: 600_000 },
      userId,
    )

    await signal(machine, 1, '10:02:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:02:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('keeps the stop the tick opened under the debounce its candidate started with', async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 0, '10:00:00')
    await policyService.upsertForWorkCenter(
      machine.workCenterId,
      { runModeDebounceMs: 300_000, microStopThresholdMs: 600_000 },
      userId,
    )
    // The tick opened the stop once the 60 s ran out and has not deleted the candidate yet
    await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:00:00'))

    await signal(machine, 1, '10:02:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:02:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })
})

// ── Pending decision records ──────────────────────────────────────────────────

describe('Pending decision records', () => {
  it('keeps a candidate and a check after a planned stop under their own keys for 25 hours', async () => {
    const machine = await machineWithDebounce(60_000)
    const check: PendingDecision = {
      kind: 'after_planned',
      since: '2026-06-15T10:30:00.000Z',
      debounceMs: 0,
      attempts: 0,
      nextAttemptAt: null,
    }
    const checkKey = `performance:runmode:after-planned:${machine.workCenterId}:${machine.runModeTagId}`

    await signal(machine, 0, '10:00:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, check)

    expect(await storedCandidate(machine)).toEqual({
      kind: 'debounce',
      since: '2026-06-15T10:00:00.000Z',
      debounceMs: 60_000,
      attempts: 0,
      nextAttemptAt: null,
    })
    expect(JSON.parse((await testRedis.get(checkKey)) ?? 'null')).toEqual(check)
    for (const key of [candidateKey(machine), checkKey]) {
      const ttlSeconds = await testRedis.ttl(key)
      expect(ttlSeconds).toBeGreaterThan(89_900)
      expect(ttlSeconds).toBeLessThanOrEqual(90_000)
    }
    expect(await readDecision('after_planned', machine.workCenterId, machine.runModeTagId)).toEqual(
      check,
    )

    await deleteDecision('after_planned', machine.workCenterId, machine.runModeTagId)

    expect(await testRedis.exists(checkKey)).toBe(0)
    expect(await testRedis.exists(candidateKey(machine))).toBe(1)
  })

  it('retries after 1, 2, 4, 8 and 16 s, then every 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 100].map(attempts => retryDelayMs(attempts))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ])
  })
})

// ── A Redis error fails the sample ────────────────────────────────────────────

// The stream consumer acknowledges a sample only when handleRunModeSample resolves. A decision that
// Redis cannot read, write or delete must therefore fail the sample and leave it unprocessed (the
// cursor stays), so the stream redelivers it, instead of losing the stop without a trace
describe('A Redis error while a sample is handled fails the sample', () => {
  it('fails a stopped sample when the candidate cannot be written, and the redelivered sample stores it', async () => {
    const machine = await machineWithDebounce(60_000)

    await whileRedisRefuses('set', async () => {
      await expect(signal(machine, 0, '10:00:00')).rejects.toThrow(/NOPERM.*'set' command/)
    })

    expect(await candidateKeys(machine)).toEqual([])
    expect(await cursorOf(machine)).toBeNull()

    await signal(machine, 0, '10:00:00')

    expect(await storedCandidate(machine)).toEqual({
      kind: 'debounce',
      since: '2026-06-15T10:00:00.000Z',
      debounceMs: 60_000,
      attempts: 0,
      nextAttemptAt: null,
    })
  })

  it('fails a running sample when the candidate cannot be read, and the redelivered sample records the stop', async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 0, '10:00:00')

    await whileRedisRefuses('get', async () => {
      await expect(signal(machine, 1, '10:05:00')).rejects.toThrow(/NOPERM.*'get' command/)
    })

    expect(await stopsOf(machine)).toEqual([])
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))
    expect(await candidateKeys(machine)).toEqual([candidateKey(machine)])

    await signal(machine, 1, '10:05:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('fails a running sample when the candidate cannot be deleted, and the redelivered sample leaves one stop and no candidate', async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 0, '10:00:00')

    await whileRedisRefuses('del', async () => {
      await expect(signal(machine, 1, '10:05:00')).rejects.toThrow(/NOPERM.*'del' command/)
    })

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))
    expect(await candidateKeys(machine)).toEqual([candidateKey(machine)])

    await signal(machine, 1, '10:05:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('fails a running sample while Redis is unreachable, and the redelivered sample records the stop', async () => {
    const machine = await machineWithDebounce(60_000)
    await signal(machine, 0, '10:00:00')

    await whileRedisIsUnreachable(async () => {
      await expect(signal(machine, 1, '10:05:00')).rejects.toThrow('Connection is closed')
    })

    expect(await stopsOf(machine)).toEqual([])
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))
    expect(await candidateKeys(machine)).toEqual([candidateKey(machine)])

    await signal(machine, 1, '10:05:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })
})

// ── Rule 6: samples telemetry stored that performance missed ─────────────────

// A sample whose predecessor in telemetry is newer than the cursor proves samples performance never
// processed: one that failed and was overtaken before its redelivery, a dead letter, a failed
// publish, a gap in the tag map. They are replayed from telemetry's history before the sample
describe('Samples performance missed are replayed from telemetry first (rule 6)', () => {
  let warn: MockInstance

  beforeEach(() => {
    warn = vi.spyOn(logger, 'warn')
  })

  afterEach(() => {
    warn.mockRestore()
  })

  const gapsReplayed = () =>
    warn.mock.calls
      .map(([, meta]) => meta)
      .filter(meta => meta?.event === 'run_mode.sample.gap_replayed')

  const gapReplayed = (machine: Machine, from: string, to: string, replayed: number) => ({
    event: 'run_mode.sample.gap_replayed',
    workCenterId: machine.workCenterId,
    runModeTagId: machine.runModeTagId,
    from: at(from).toISOString(),
    to: at(to).toISOString(),
    replayed,
  })

  it('replays a failed running signal that a newer sample overtook, before that sample', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    const running = recorded(machine, 1, '10:05:00')
    await whileRedisRefuses('get', async () => {
      await expect(deliver(machine, running)).rejects.toThrow(/NOPERM.*'get' command/)
    })

    // The stream goes on with the next sample before it redelivers the failed one
    await deliver(machine, recorded(machine, 0, '10:20:00'))

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:20:00'))
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:20:00'))
    expect(gapsReplayed()).toEqual([gapReplayed(machine, '10:00:00', '10:20:00', 1)])
    expect(received.stateDurations).toEqual([
      {
        tagId: machine.runModeTagId,
        from: at('10:00:00').toISOString(),
        to: at('10:20:00').toISOString(),
      },
    ])

    await deliver(machine, running)

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:20:00'))

    await deliver(machine, recorded(machine, 1, '10:25:00'))

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:00:00', '10:05:00'),
      runModeStop('10:20:00', '10:25:00'),
    ])
    expect(await candidateKeys(machine)).toEqual([])
    expect(gapsReplayed()).toHaveLength(1)
  })

  it('replays a running signal whose candidate could not be deleted without a second stop', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    await whileRedisRefuses('del', async () => {
      await expect(deliver(machine, recorded(machine, 1, '10:05:00'))).rejects.toThrow(
        /NOPERM.*'del' command/,
      )
    })

    await deliver(machine, recorded(machine, 0, '10:20:00'))

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:20:00'))

    await deliver(machine, recorded(machine, 1, '10:25:00'))

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:00:00', '10:05:00'),
      runModeStop('10:20:00', '10:25:00'),
    ])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('replays two samples that never reached performance, in their order', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    recorded(machine, 1, '10:05:00')
    recorded(machine, 0, '10:10:00')

    await deliver(machine, recorded(machine, 1, '10:15:00'))

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:00:00', '10:05:00'),
      runModeStop('10:10:00', '10:15:00'),
    ])
    expect(await candidateKeys(machine)).toEqual([])
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:15:00'))
    expect(gapsReplayed()).toEqual([gapReplayed(machine, '10:00:00', '10:15:00', 2)])
  })

  it('asks telemetry nothing when a sample follows the one processed last', async () => {
    const machine = await machineWithDebounce(60_000)

    // The tag's first stored sample has no predecessor, the next one names the first
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    await deliver(machine, recorded(machine, 1, '10:05:00'))

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(received.stateDurations).toEqual([])
    expect(gapsReplayed()).toEqual([])
  })

  it('asks telemetry nothing for a sample of a tag performance has no cursor for', async () => {
    const machine = await machineWithDebounce(60_000)
    // Stored before the tag reached performance's map
    recorded(machine, 1, '09:00:00')

    await deliver(machine, recorded(machine, 0, '10:00:00'))

    expect(await storedCandidate(machine)).toEqual(candidateSince('10:00:00'))
    expect(received.stateDurations).toEqual([])
    expect(gapsReplayed()).toEqual([])
  })

  it('fails the sample while telemetry cannot answer, and its redelivery replays the gap', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    recorded(machine, 1, '10:05:00')
    recorded(machine, 0, '10:10:00')
    const running = recorded(machine, 1, '10:15:00')
    stubs.stateDurations.mode = 'fail'

    await expect(deliver(machine, running)).rejects.toThrow('error.telemetry_unreachable')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:00:00'))
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))

    stubs.stateDurations.mode = 'answer'
    await deliver(machine, running)

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:00:00', '10:05:00'),
      runModeStop('10:10:00', '10:15:00'),
    ])
    expect(await candidateKeys(machine)).toEqual([])
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:15:00'))
  })

  it('keeps what it replayed before a failure, and the redelivery replays the rest', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    recorded(machine, 1, '10:05:00')
    recorded(machine, 0, '10:10:00')
    const running = recorded(machine, 1, '10:15:00')

    // The replayed 10:05 sample records its stop, the 10:10 one cannot write its candidate
    await whileRedisRefuses('set', async () => {
      await expect(deliver(machine, running)).rejects.toThrow(/NOPERM.*'set' command/)
    })

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await candidateKeys(machine)).toEqual([])
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:05:00'))

    await deliver(machine, running)

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:00:00', '10:05:00'),
      runModeStop('10:10:00', '10:15:00'),
    ])
    expect(await candidateKeys(machine)).toEqual([])
  })
})
