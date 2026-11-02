import '../../../test/contract-setup.js'

import { once } from 'node:events'
import type { Server } from 'node:http'
import express, { type Request, type Response } from 'express'
import mongoose, { Types } from 'mongoose'
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
import * as plannedStopService from '../../planned-stop/planned-stop.service.js'
import * as policyService from '../../policy/policy.service.js'
import { bootstrapSystemReasons } from '../../reason/reason.bootstrap.js'
import { Reason } from '../../reason/reason.model.js'
import { UnplannedStop } from '../../unplanned-stop/unplanned-stop.model.js'
import * as unplannedStopService from '../../unplanned-stop/unplanned-stop.service.js'
import { runDecisionTick, startDebounceTick, stopDebounceTick } from '../run-mode.debounce-tick.js'
import {
  deleteDecision,
  type PendingDecision,
  readDecision,
  retryDelayMs,
  writeDecision,
} from '../run-mode.decisions.js'
import { handleRunModeSample } from '../run-mode.processor.js'
import { reconcileOnBoot } from '../run-mode.reconciler.js'
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

// The tag's last stored sample, as telemetry's latest endpoint answers it
function latestSample(req: Request) {
  const tagId = String(req.params.tagId)
  const last = telemetryHistory.get(tagId)?.at(-1)
  return last ? { tagId, value: last.value, occurredAt: last.occurredAt } : null
}

let stubs: Record<Endpoint, StubEndpoint>
// The requests each endpoint received, as their path parameters and query
let received: Record<Endpoint, Record<string, unknown>[]>

function resetStubs(): void {
  stubs = {
    workCenter: { mode: 'answer', answer: () => null },
    runModeMonitors: { mode: 'answer', answer: () => [] },
    latest: { mode: 'answer', answer: latestSample },
    stateDurations: { mode: 'answer', answer: stateDurations },
  }
  received = { workCenter: [], runModeMonitors: [], latest: [], stateDurations: [] }
  telemetryHistory.clear()
}

// Requests held by a hanging endpoint, released after each test
const held = new Set<Response>()

// A hanging endpoint answers the requests it holds at last: those `which` picks, or all of them
function releaseHeld(
  respond: (res: Response) => void,
  which: (req: Request) => boolean = () => true,
): void {
  for (const res of held) {
    if (!which(res.req)) continue
    respond(res)
    held.delete(res)
  }
}

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

// MongoDB refuses every new unplanned stop with a server error until fn is done: a validator no
// document passes
async function whileMongoRefusesStops<T>(fn: () => Promise<T>): Promise<T> {
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB is not connected')
  const collMod = UnplannedStop.collection.collectionName
  await db.command({ collMod, validator: { $expr: false } })
  try {
    return await fn()
  } finally {
    await db.command({ collMod, validator: {} })
  }
}

// The decision tick, as production runs it every second, at a time of the server's clock
const tick = (time: string) => runDecisionTick(at(time))

const openRunModeStop = (from: string) => ({ source: 'run_mode', startAt: at(from), endAt: null })

// The check a planned stop that closed at the given time leaves when the run mode cannot be read
const afterPlannedSince = (time: string): PendingDecision => ({
  kind: 'after_planned',
  since: at(time).toISOString(),
  debounceMs: 0,
  attempts: 0,
  nextAttemptAt: null,
})

async function storedCheck(machine: Machine): Promise<PendingDecision | null> {
  const raw = await testRedis.get(
    `performance:runmode:after-planned:${machine.workCenterId}:${machine.runModeTagId}`,
  )
  return raw === null ? null : (JSON.parse(raw) as PendingDecision)
}

async function activePlannedStop(machine: Machine, from: string, to: string) {
  const reason = await seedReason('planned_stop')
  return PlannedStop.create({
    workCenterId: new Types.ObjectId(machine.workCenterId),
    reasonId: reason._id,
    plannedOwnerId: new Types.ObjectId(userId),
    source: 'manual',
    startMode: 'manual',
    status: 'active',
    plannedStartAt: at(from),
    plannedEndAt: at(to),
    actualStartAt: at(from),
    createdBy: new Types.ObjectId(userId),
  })
}

const closePlannedStop = (plannedStopId: Types.ObjectId, time: string) =>
  PlannedStop.updateOne(
    { _id: plannedStopId },
    { $set: { status: 'closed', actualEndAt: at(time) } },
  )

// Every line the service logs at warn and error, and its info lines about pending decisions and the
// tick that decides them, in order, with the level of each line
function watchDecisionLogs() {
  const spies = (['info', 'warn', 'error'] as const).map(level => {
    const spy: MockInstance = vi.spyOn(logger, level)
    return { level, spy }
  })
  return {
    lines: () =>
      spies
        .flatMap(({ level, spy }) =>
          spy.mock.calls.map(([, meta], i) => ({
            level,
            meta,
            order: spy.mock.invocationCallOrder[i],
          })),
        )
        .filter(
          ({ level, meta }) =>
            level !== 'info' || /^run_mode\.(decision|debounce_tick)\./.test(String(meta?.event)),
        )
        .sort((a, b) => a.order - b.order)
        .map(({ level, meta }) => [level, meta]),
    restore: () => {
      for (const { spy } of spies) spy.mockRestore()
    },
  }
}

// The performance service started again: every module loaded afresh, with Redis clients of its own,
// and nothing kept from before but what Redis and MongoDB hold
async function restartedTick() {
  vi.resetModules()
  // The fresh modules compile their models again on the same connection
  mongoose.set('overwriteModels', true)
  try {
    const redis = await import('../../../lib/redis.js')
    await redis.initRedis()
    const { runDecisionTick } = await import('../run-mode.debounce-tick.js')
    return { runDecisionTick, redisClient: redis.redisClient, stop: redis.closeRedis }
  } finally {
    mongoose.set('overwriteModels', false)
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
    const open = await unplannedStopService.openFromRunMode(
      machine.workCenterId,
      at('10:00:00'),
      60_000,
    )

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
    // As the tick opens it once its candidate's 60 s have run out
    await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:00:00'), 60_000)

    await signal(machine, 1, '10:00:20')

    expect(await stopsOf(machine)).toEqual([])
  })

  it('a short run-mode stop a user has changed is closed and kept when the late running signal arrives', async () => {
    const machine = await machineWithDebounce(60_000)
    const open = await unplannedStopService.openFromRunMode(
      machine.workCenterId,
      at('10:00:00'),
      60_000,
    )
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

// ── Rule 2: a late running signal never closes a stop that started after it ──

describe('A late running signal never closes a stop that started after it (rule 2)', () => {
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

  it('deletes an untouched run-mode stop opened after the signal', async () => {
    const machine = await machineWithDebounce(60_000)
    // A planned stop that closed at 10:30 opened it from a history that did not hold the machine's
    // 10:25 running signal yet: the signal shows the machine was running by then
    await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:30:00'))

    await signal(machine, 1, '10:25:00')

    expect(await stopsOf(machine)).toEqual([])
  })

  it('leaves a run-mode stop a user changed after the signal open', async () => {
    const machine = await machineWithDebounce(60_000)
    const open = await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:30:00'))
    const reason = await seedReason('unplanned_stop')
    await unplannedStopService.patch(
      open._id.toString(),
      { reasonId: reason._id.toString() },
      userId,
    )

    await signal(machine, 1, '10:25:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])
    expect((await UnplannedStop.findById(open._id).lean())?.reasonId?.toString()).toBe(
      reason._id.toString(),
    )
  })
})

// ── Rule 2: only the stop the tick opened from a candidate is debounced ──────

// A stop opened at the end of a planned stop, or at once with D = 0, closes at the running signal
// however short; the tick's stop carries the debounce of the candidate it came from
describe('Only the stop the tick opened from a candidate is debounced (rule 2)', () => {
  it('keeps a short stop opened at the end of a planned stop whose run mode could be read', async () => {
    const machine = await machineWithDebounce(60_000)
    stubs.workCenter.answer = () => ({
      _id: machine.workCenterId,
      type: 'physical',
      tagBindings: { runModeTagId: machine.runModeTagId },
    })
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    // The machine stops during the planned stop, which covers the sample
    await deliver(machine, recorded(machine, 0, '10:02:00'))

    await plannedStopService.close(planned._id.toString(), { actualEndAt: at('10:30:00') }, userId)

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])

    await deliver(machine, recorded(machine, 1, '10:30:30'))

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:30:30')])
  })

  it('keeps a short stop the check after a planned stop opened', async () => {
    const machine = await machineWithDebounce(60_000)
    recorded(machine, 0, '10:10:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))
    // Telemetry answers before it has stored the machine's running signal
    await tick('10:30:10')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])

    await deliver(machine, recorded(machine, 1, '10:30:30'))

    // As when the check already sees the running signal
    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:30:30')])
  })

  it('deletes the stop the tick opened once the running signal shows it shorter than its debounce', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    // Telemetry has not stored the machine's running signal yet when the 60 s run out
    await tick('10:01:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:00:00')])

    await deliver(machine, recorded(machine, 1, '10:00:30'))

    expect(await stopsOf(machine)).toEqual([])
  })

  it('deletes it under the debounce its candidate carried when the policy changes', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    await tick('10:01:00')
    await policyService.upsertForWorkCenter(
      machine.workCenterId,
      { runModeDebounceMs: 10_000 },
      userId,
    )

    await deliver(machine, recorded(machine, 1, '10:00:30'))

    expect(await stopsOf(machine)).toEqual([])
  })

  it('keeps a short stop opened at once with a debounce of 0', async () => {
    const machine = await machineWithDebounce(0)
    await deliver(machine, recorded(machine, 0, '10:00:00'))

    await deliver(machine, recorded(machine, 1, '10:00:01'))

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:00:01')])
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
    await unplannedStopService.openFromRunMode(machine.workCenterId, at('10:00:00'), 60_000)

    await signal(machine, 1, '10:02:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:02:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('confirms a candidate once the debounce it started with has run out', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    await policyService.upsertForWorkCenter(
      machine.workCenterId,
      { runModeDebounceMs: 300_000, microStopThresholdMs: 600_000 },
      userId,
    )

    await tick('10:01:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:00:00')])
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
    // Unlike a pending decision's attempts, each failed replay logs the cause at warn
    expect(warn.mock.calls.map(([, meta]) => meta)).toContainEqual({
      event: 'internal_api.telemetry.fetch_failed',
      path: expect.stringContaining(
        `/internal/v1/historian/${machine.runModeTagId}/state-durations`,
      ),
      status: 500,
    })

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

  // The stream consumer runs one handler at a time, so a replay waiting on a telemetry that never
  // answers would hold up every performance stream
  it('fails the sample within 5 s while telemetry never answers, and decides nothing for it', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    recorded(machine, 1, '10:05:00')
    recorded(machine, 0, '10:10:00')
    const running = recorded(machine, 1, '10:15:00')
    stubs.stateDurations.mode = 'hang'

    const startedAt = Date.now()
    await expect(deliver(machine, running)).rejects.toThrow('error.telemetry_unreachable')

    expect(Date.now() - startedAt).toBeLessThan(6_000)
    // Telemetry never answered: performance gave up on the request
    expect(held.size).toBe(1)
    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:00:00'))
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))
  }, 15_000)

  // Two paths handle the tag at once: the stream's sample waits for its replay, outside the tag's
  // lock, while the boot reconciler replays the same samples and a later one
  it('decides each sample once and never moves the cursor back when another path handles the tag meanwhile', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    recorded(machine, 1, '10:05:00')
    const stoppedAgain = recorded(machine, 0, '10:10:00')
    const runningAgain = recorded(machine, 1, '10:20:00')
    stubs.stateDurations.mode = 'hang'
    const delivered = deliver(machine, stoppedAgain)
    await vi.waitFor(() => expect(held.size).toBe(1))

    stubs.stateDurations.mode = 'answer'
    await reconcileOnBoot({ now: at('10:30:00'), monitored: [machine] })

    const stops = [runModeStop('10:00:00', '10:05:00'), runModeStop('10:10:00', '10:20:00')]
    expect(await stopsOf(machine)).toEqual(stops)
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:20:00'))

    releaseHeld(res => res.json({ data: stateDurations(res.req) }))
    await delivered

    expect(await stopsOf(machine)).toEqual(stops)
    expect(await candidateKeys(machine)).toEqual([])
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:20:00'))

    // The later sample's own delivery comes after, and finds it decided
    await deliver(machine, runningAgain)

    expect(await stopsOf(machine)).toEqual(stops)
    expect(await candidateKeys(machine)).toEqual([])
  })
})

// ── Rule 3: the tick decides a candidate whose debounce has run out ──────────

describe('The tick opens a stop once telemetry answers again (scenario 1)', () => {
  it('opens the stop at its first stop time once telemetry is back', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    stubs.latest.mode = 'fail'

    await tick('10:01:00')

    // "Cannot answer" never means "stopped": the candidate waits
    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toMatchObject({
      since: at('10:00:00').toISOString(),
      attempts: 1,
    })

    // Back ten minutes later, with the stopped sample still the tag's latest
    stubs.latest.mode = 'answer'
    await tick('10:10:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:00:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })
})

describe('The tick waits for a sample performance has not processed yet (scenario 4)', () => {
  it('waits for the signal when telemetry knows a newer sample', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    // Stored by telemetry, still on its way to performance
    const running = recorded(machine, 1, '10:05:00')

    await tick('10:05:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:00:00'))

    await deliver(machine, running)

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('waits as well when the newer sample is a stopped one', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    // The machine ran and stopped again; neither sample has reached performance yet
    recorded(machine, 1, '10:05:00')
    const stoppedAgain = recorded(machine, 0, '10:10:00')

    await tick('10:12:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:00:00'))

    await deliver(machine, stoppedAgain)

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:10:00'))
  })

  it('records nothing when the newer sample shows the stop was shorter than the debounce', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    const running = recorded(machine, 1, '10:00:20')

    await tick('10:01:00')
    await deliver(machine, running)

    expect(await stopsOf(machine)).toEqual([])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('keeps the candidate for the replay of a sample performance missed', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    // It never reaches performance, and telemetry holds it as the tag's latest sample
    recorded(machine, 1, '10:05:00')

    await tick('10:10:00')

    expect(await storedCandidate(machine)).toEqual(candidateSince('10:00:00'))

    // The next sample replays the missed one first, which decides the candidate
    await deliver(machine, recorded(machine, 0, '10:20:00'))

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:20:00'))
  })
})

describe('The tick and a running signal decide the same candidate (scenario 5)', () => {
  let logs: ReturnType<typeof watchDecisionLogs>

  beforeEach(() => {
    logs = watchDecisionLogs()
  })

  afterEach(() => {
    logs.restore()
  })

  it('writes one stop when the tick and a running signal decide together', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    // Telemetry answers the tick before it has stored the running sample
    stubs.latest.answer = () => ({
      tagId: machine.runModeTagId,
      value: 0,
      occurredAt: at('10:00:00'),
    })

    await Promise.all([tick('10:05:00'), signal(machine, 1, '10:05:00')])

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await candidateKeys(machine)).toEqual([])
    // Neither writer failed: the tick logs any decision it fails
    expect(logs.lines()).toEqual([])
  })

  it('does not bring back a candidate the running signal decided while telemetry was asked', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    stubs.latest.mode = 'hang'
    const pending = tick('10:05:00')
    await vi.waitFor(() => expect(held.size).toBe(1))

    await deliver(machine, recorded(machine, 1, '10:05:00'))
    // Only now telemetry fails the tick's question
    releaseHeld(res =>
      res.status(500).json({ error: { code: 'error.internal', message: 'Internal error' } }),
    )
    await pending

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await candidateKeys(machine)).toEqual([])
    expect(logs.lines()).toEqual([])
  })

  it('leaves the candidate of a newer stop when it decides an older one late', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    stubs.latest.mode = 'hang'
    const pending = tick('10:05:00')
    await vi.waitFor(() => expect(held.size).toBe(1))

    // While telemetry has not answered the tick, the machine runs and stops again
    await deliver(machine, recorded(machine, 1, '10:05:00'))
    await deliver(machine, recorded(machine, 0, '10:06:00'))
    releaseHeld(res =>
      res.json({ data: { tagId: machine.runModeTagId, value: 0, occurredAt: at('10:00:00') } }),
    )
    await pending

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:06:00'))
  })

  // An answer telemetry computed before it stored the running sample still names T0; a stop opened
  // from it now would stay open, as no running signal is left to close it
  it('opens no stop when the running signal decides a short stop while telemetry is asked', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    stubs.latest.mode = 'hang'
    const pending = tick('10:01:00')
    await vi.waitFor(() => expect(held.size).toBe(1))
    const [question] = held
    const answer = latestSample(question.req)

    await deliver(machine, recorded(machine, 1, '10:00:20'))
    releaseHeld(res => res.json({ data: answer }))
    await pending

    expect(await stopsOf(machine)).toEqual([])
    expect(await candidateKeys(machine)).toEqual([])
    expect(logs.lines()).toEqual([])
  })
})

// ── Rule 4: the check after a planned stop ───────────────────────────────────

describe('The check after a planned stop decides once telemetry answers (scenario 7)', () => {
  it('records the stop after a planned stop once telemetry is back', async () => {
    const machine = await machineWithDebounce(60_000)
    recorded(machine, 0, '10:10:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))
    recorded(machine, 1, '10:34:00')
    stubs.stateDurations.mode = 'fail'

    await tick('10:31:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toMatchObject({
      since: at('10:30:00').toISOString(),
      attempts: 1,
    })

    stubs.stateDurations.mode = 'answer'
    await tick('10:40:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:34:00')])
    expect(await storedCheck(machine)).toBeNull()
    expect(received.stateDurations.at(-1)).toEqual({
      tagId: machine.runModeTagId,
      from: at('10:30:00').toISOString(),
      to: at('10:40:00').toISOString(),
    })
  })

  it('opens the stop at the end of the planned stop while the machine still stands', async () => {
    const machine = await machineWithDebounce(60_000)
    recorded(machine, 0, '10:10:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))

    await tick('10:40:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('records nothing when the machine was running when the planned stop ended', async () => {
    const machine = await machineWithDebounce(60_000)
    recorded(machine, 0, '10:10:00')
    recorded(machine, 1, '10:25:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))

    await tick('10:40:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('records nothing when the history cannot tell the state at the end of the planned stop', async () => {
    const machine = await machineWithDebounce(60_000)
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))
    // The tag's first stored sample comes after E; rule 1 decides it when it arrives
    recorded(machine, 0, '10:35:00')

    await tick('10:40:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('applies no debounce to the check', async () => {
    const machine = await machineWithDebounce(60_000)
    recorded(machine, 0, '10:10:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))
    recorded(machine, 1, '10:30:10')

    await tick('10:40:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:30:10')])
  })

  it('waits until the end of the planned stop has passed', async () => {
    const machine = await machineWithDebounce(60_000)
    recorded(machine, 0, '10:10:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))

    // A tick in the same millisecond as E would read an empty history
    await tick('10:30:00')

    expect(received.stateDurations).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:30:01')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])
  })

  // Telemetry can answer before it has stored what the broker queued while it was down, so the
  // check can open a stop at E that a running signal still on its way contradicts
  it('drops the stop it opened once the late running signal shows the machine ran before E', async () => {
    const machine = await machineWithDebounce(60_000)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    // The machine stops during the planned stop, which covers the sample
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    await closePlannedStop(planned._id, '10:30:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))

    await tick('10:31:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])

    await deliver(machine, recorded(machine, 1, '10:25:00'))

    expect(await stopsOf(machine)).toEqual([])
  })

  it('opens a stop again when the machine stops after the late running signal', async () => {
    const machine = await machineWithDebounce(0)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    await closePlannedStop(planned._id, '10:30:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))
    await tick('10:31:00')

    await deliver(machine, recorded(machine, 1, '10:25:00'))
    await deliver(machine, recorded(machine, 0, '10:40:00'))

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:40:00')])
  })

  // A planned stop from 10:00 covers 0@10:02 and closes at E = 10:30. The tick asks for the history
  // since E, and the running sample is processed before telemetry's answer, computed without it,
  // arrives
  async function checkAskedWhileRunningArrives(runningAt: string) {
    const machine = await machineWithDebounce(60_000)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    await closePlannedStop(planned._id, '10:30:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))
    stubs.stateDurations.mode = 'hang'
    const pending = tick('10:33:00')
    await vi.waitFor(() => expect(held.size).toBe(1))
    const [question] = held
    const history = stateDurations(question.req)

    await deliver(machine, recorded(machine, 1, runningAt))
    releaseHeld(res => res.json({ data: history }))
    await pending
    stubs.stateDurations.mode = 'answer'
    return machine
  }

  it('opens nothing from a history that missed a running signal processed meanwhile, and the next tick records the stop', async () => {
    const machine = await checkAskedWhileRunningArrives('10:32:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:34:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:32:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('records nothing once the next tick sees the running signal before E that was processed meanwhile', async () => {
    const machine = await checkAskedWhileRunningArrives('10:28:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:34:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toBeNull()
  })
})

// ── Errors and retries ────────────────────────────────────────────────────────

describe('A decision telemetry cannot answer waits on the retry schedule (scenario 8)', () => {
  let logs: ReturnType<typeof watchDecisionLogs>

  beforeEach(() => {
    logs = watchDecisionLogs()
  })

  afterEach(() => {
    logs.restore()
  })

  // Runs the tick every second from the given time and returns the seconds at which telemetry was
  // asked, each with the record the failed attempt left
  async function tickEverySecond(
    from: Date,
    seconds: number,
    asked: () => number,
    stored: () => Promise<PendingDecision | null>,
  ) {
    const attempts: { second: number; attempts?: number; nextAttemptAt?: string | null }[] = []
    for (let second = 0; second <= seconds; second++) {
      const before = asked()
      await runDecisionTick(new Date(from.getTime() + second * 1000))
      if (asked() > before) {
        const record = await stored()
        attempts.push({ second, attempts: record?.attempts, nextAttemptAt: record?.nextAttemptAt })
      }
    }
    return attempts
  }

  it('retries on schedule and logs only the deferral and the decision', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    stubs.latest.mode = 'fail'

    const attempts = await tickEverySecond(
      at('10:01:00'),
      100,
      () => received.latest.length,
      () => storedCandidate(machine),
    )

    expect(attempts).toEqual([
      { second: 0, attempts: 1, nextAttemptAt: at('10:01:01').toISOString() },
      { second: 1, attempts: 2, nextAttemptAt: at('10:01:03').toISOString() },
      { second: 3, attempts: 3, nextAttemptAt: at('10:01:07').toISOString() },
      { second: 7, attempts: 4, nextAttemptAt: at('10:01:15').toISOString() },
      { second: 15, attempts: 5, nextAttemptAt: at('10:01:31').toISOString() },
      { second: 31, attempts: 6, nextAttemptAt: at('10:02:01').toISOString() },
      { second: 61, attempts: 7, nextAttemptAt: at('10:02:31').toISOString() },
      { second: 91, attempts: 8, nextAttemptAt: at('10:03:01').toISOString() },
    ])
    expect(await stopsOf(machine)).toEqual([])
    // The retries keep the 25 hours the record was written with
    expect(await testRedis.ttl(candidateKey(machine))).toBeGreaterThan(89_900)

    stubs.latest.mode = 'answer'
    await tick('10:03:01')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:00:00')])
    expect(await candidateKeys(machine)).toEqual([])
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'run_mode.decision.deferred',
          kind: 'debounce',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
          nextAttemptAt: at('10:01:01').toISOString(),
          error: 'error.telemetry_unreachable',
          cause: 'HTTP 500',
        },
      ],
      [
        'info',
        {
          event: 'run_mode.decision.resolved',
          kind: 'debounce',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
          attempts: 8,
          waitedMs: 121_000,
        },
      ],
    ])
  })

  it('defers a decision MongoDB cannot write on the same schedule and asks telemetry only when it is due', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))

    const attempts = await whileMongoRefusesStops(() =>
      tickEverySecond(
        at('10:01:00'),
        20,
        () => received.latest.length,
        () => storedCandidate(machine),
      ),
    )

    expect(attempts).toEqual([
      { second: 0, attempts: 1, nextAttemptAt: at('10:01:01').toISOString() },
      { second: 1, attempts: 2, nextAttemptAt: at('10:01:03').toISOString() },
      { second: 3, attempts: 3, nextAttemptAt: at('10:01:07').toISOString() },
      { second: 7, attempts: 4, nextAttemptAt: at('10:01:15').toISOString() },
      { second: 15, attempts: 5, nextAttemptAt: at('10:01:31').toISOString() },
    ])
    expect(await stopsOf(machine)).toEqual([])

    await tick('10:01:31')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:00:00')])
    expect(await candidateKeys(machine)).toEqual([])
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'run_mode.decision.deferred',
          kind: 'debounce',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
          nextAttemptAt: at('10:01:01').toISOString(),
          error: 'Document failed validation',
        },
      ],
      [
        'info',
        {
          event: 'run_mode.decision.resolved',
          kind: 'debounce',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
          attempts: 5,
          waitedMs: 31_000,
        },
      ],
    ])
  })

  it('retries a check after a planned stop on the same schedule', async () => {
    const machine = await machineWithDebounce(60_000)
    recorded(machine, 0, '10:10:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))
    recorded(machine, 1, '10:30:10')
    stubs.stateDurations.mode = 'fail'

    const attempts = await tickEverySecond(
      at('10:30:01'),
      20,
      () => received.stateDurations.length,
      () => storedCheck(machine),
    )

    expect(attempts).toEqual([
      { second: 0, attempts: 1, nextAttemptAt: at('10:30:02').toISOString() },
      { second: 1, attempts: 2, nextAttemptAt: at('10:30:04').toISOString() },
      { second: 3, attempts: 3, nextAttemptAt: at('10:30:08').toISOString() },
      { second: 7, attempts: 4, nextAttemptAt: at('10:30:16').toISOString() },
      { second: 15, attempts: 5, nextAttemptAt: at('10:30:32').toISOString() },
    ])

    stubs.stateDurations.mode = 'answer'
    await tick('10:30:32')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:30:10')])
    expect(await storedCheck(machine)).toBeNull()
    expect(logs.lines()).toEqual([
      [
        'warn',
        expect.objectContaining({
          event: 'run_mode.decision.deferred',
          kind: 'after_planned',
          cause: 'HTTP 500',
        }),
      ],
      [
        'info',
        {
          event: 'run_mode.decision.resolved',
          kind: 'after_planned',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:30:00').toISOString(),
          attempts: 5,
          waitedMs: 32_000,
        },
      ],
    ])
  })

  it('logs the decision when the running signal decides a deferred candidate', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    stubs.latest.mode = 'fail'
    await tick('10:01:00')

    await deliver(machine, recorded(machine, 1, '10:05:00'))

    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:00', '10:05:00')])
    expect(logs.lines()).toEqual([
      ['warn', expect.objectContaining({ event: 'run_mode.decision.deferred' })],
      [
        'info',
        {
          event: 'run_mode.decision.resolved',
          kind: 'debounce',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
          attempts: 1,
          waitedMs: expect.any(Number),
        },
      ],
    ])
  })

  it('drops a decision after 24 hours with an error log', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    stubs.latest.mode = 'fail'
    const firstStoppedAt = at('10:00:00').getTime()

    // 23 h 59 min after the stop it is still pending, and asked again
    await runDecisionTick(new Date(firstStoppedAt + 23 * 3_600_000 + 59 * 60_000))

    expect(received.latest).toHaveLength(1)
    expect(await storedCandidate(machine)).toMatchObject({ attempts: 1 })

    await runDecisionTick(new Date(firstStoppedAt + 24 * 3_600_000 + 1000))

    expect(await candidateKeys(machine)).toEqual([])
    expect(await stopsOf(machine)).toEqual([])
    expect(received.latest).toHaveLength(1)
    expect(logs.lines()).toEqual([
      ['warn', expect.objectContaining({ event: 'run_mode.decision.deferred' })],
      [
        'error',
        {
          event: 'run_mode.decision.abandoned',
          kind: 'debounce',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
          attempts: 1,
        },
      ],
    ])
  })
})

describe('A pending decision across a restart (scenario 11)', () => {
  it('decides a candidate written before a restart', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))

    const restarted = await restartedTick()
    try {
      expect(restarted.redisClient).not.toBe(redisClient)
      await restarted.runDecisionTick(at('10:01:00'))
    } finally {
      await restarted.stop()
    }

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:00:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })

  it('goes on with the attempts of a record written before a restart', async () => {
    const machine = await machineWithDebounce(60_000)
    recorded(machine, 0, '10:00:00')
    await writeDecision(machine.workCenterId, machine.runModeTagId, {
      ...candidateSince('10:00:00'),
      attempts: 3,
      nextAttemptAt: at('10:01:07').toISOString(),
    })
    stubs.latest.mode = 'fail'

    const restarted = await restartedTick()
    try {
      await restarted.runDecisionTick(at('10:01:06'))
      expect(received.latest).toEqual([])

      await restarted.runDecisionTick(at('10:01:07'))
    } finally {
      await restarted.stop()
    }

    expect(received.latest).toHaveLength(1)
    expect(await storedCandidate(machine)).toEqual({
      ...candidateSince('10:00:00'),
      attempts: 4,
      nextAttemptAt: at('10:01:15').toISOString(),
    })
  })
})

// ── Review focus 1: a machine clock ahead of the server ──────────────────────

describe('A machine clock ahead of the server (review focus 1)', () => {
  it('does not confirm a stop stamped ahead of the server clock', async () => {
    const machine = await machineWithDebounce(60_000)
    // The machine's clock runs two minutes ahead: its 10:02 is the server's 10:00
    await deliver(machine, recorded(machine, 0, '10:02:00'))

    await tick('10:00:00')
    await tick('10:01:00')
    await tick('10:02:59')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:02:00'))
    expect(received.latest).toEqual([])

    // The server clock reaches T0 + D
    await tick('10:03:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:02:00')])
    expect(await candidateKeys(machine)).toEqual([])
  })
})

// ── Review focus 2: telemetry that hangs instead of refusing ─────────────────

describe('Telemetry that never answers (review focus 2)', () => {
  let logs: ReturnType<typeof watchDecisionLogs>

  beforeEach(() => {
    logs = watchDecisionLogs()
  })

  afterEach(() => {
    logs.restore()
  })

  it('decides other work centers while telemetry hangs for one', async () => {
    const hanging = await machineWithDebounce(60_000)
    const answering = await machineWithDebounce(60_000)
    await deliver(hanging, recorded(hanging, 0, '10:00:00'))
    await deliver(answering, recorded(answering, 0, '10:00:00'))
    stubs.latest.mode = 'hang'

    const startedAt = Date.now()
    const pending = tick('10:01:00')
    // Both questions are out at once, so neither waits for the other's answer; one gets it
    await vi.waitFor(() => expect(held.size).toBe(2), { timeout: 4_000 })
    releaseHeld(
      res => res.json({ data: latestSample(res.req) }),
      req => req.params.tagId === answering.runModeTagId,
    )
    await vi.waitFor(
      async () => expect(await stopsOf(answering)).toEqual([openRunModeStop('10:00:00')]),
      { timeout: 5_000, interval: 20 },
    )

    expect(Date.now() - startedAt).toBeLessThan(5_000)

    await pending

    // Cut off after 5 s, which counts as "cannot answer"
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_900)
    expect(Date.now() - startedAt).toBeLessThan(6_000)
    expect(held.size).toBe(1)
    expect(await stopsOf(hanging)).toEqual([])
    expect(await storedCandidate(hanging)).toEqual({
      ...candidateSince('10:00:00'),
      attempts: 1,
      nextAttemptAt: at('10:01:01').toISOString(),
    })
    expect(logs.lines()).toEqual([
      [
        'warn',
        expect.objectContaining({
          event: 'run_mode.decision.deferred',
          workCenterId: hanging.workCenterId,
          error: 'error.telemetry_unreachable',
          cause: 'The operation was aborted due to timeout',
        }),
      ],
    ])
  }, 15_000)
})

// ── Rules 3 and 4: a tag telemetry does not know ─────────────────────────────

describe('A tag telemetry does not know (rules 3 and 4)', () => {
  let logs: ReturnType<typeof watchDecisionLogs>

  beforeEach(() => {
    logs = watchDecisionLogs()
  })

  afterEach(() => {
    logs.restore()
  })

  it('drops a candidate whose tag telemetry does not know', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    stubs.latest.answer = () => null

    await tick('10:01:00')

    expect(await candidateKeys(machine)).toEqual([])
    expect(await stopsOf(machine)).toEqual([])
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'run_mode.decision.unknown_tag',
          kind: 'debounce',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
        },
      ],
    ])
  })

  it('drops a check after a planned stop whose tag telemetry does not know', async () => {
    const machine = await machineWithDebounce(60_000)
    await writeDecision(machine.workCenterId, machine.runModeTagId, afterPlannedSince('10:30:00'))
    stubs.stateDurations.answer = () => null

    await tick('10:31:00')

    expect(await storedCheck(machine)).toBeNull()
    expect(await stopsOf(machine)).toEqual([])
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'run_mode.decision.unknown_tag',
          kind: 'after_planned',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:30:00').toISOString(),
        },
      ],
    ])
  })
})

// ── The tick while Redis cannot answer ───────────────────────────────────────

describe('The tick when Redis cannot list the pending decisions', () => {
  let logs: ReturnType<typeof watchDecisionLogs>

  beforeEach(() => {
    logs = watchDecisionLogs()
  })

  afterEach(() => {
    stopDebounceTick()
    logs.restore()
  })

  // The SCAN commands Redis has refused so far, as its command statistics count them
  async function refusedScans(): Promise<number> {
    const stats = await testRedis.info('commandstats')
    return Number(/cmdstat_scan:.*rejected_calls=(\d+)/.exec(stats)?.[1] ?? 0)
  }

  it('logs once when the listing starts failing and once when it works again, then decides', async () => {
    const machine = await machineWithDebounce(60_000)
    // A stop two minutes old on the server's own clock, which the tick started below runs on
    const firstStoppedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 120_000)
    telemetryHistory.set(machine.runModeTagId, [{ occurredAt: firstStoppedAt, value: 0 }])
    await writeDecision(machine.workCenterId, machine.runModeTagId, {
      ...candidateSince('10:00:00'),
      since: firstStoppedAt.toISOString(),
    })
    const refusedBefore = await refusedScans()

    await whileRedisRefuses('scan', async () => {
      startDebounceTick()
      // Three ticks could not list, so a failure neither ends the loop nor logs again
      await vi.waitFor(
        async () => expect(await refusedScans()).toBeGreaterThanOrEqual(refusedBefore + 3),
        { timeout: 6_000, interval: 100 },
      )
    })

    await vi.waitFor(
      async () => {
        expect(await stopsOf(machine)).toEqual([
          { source: 'run_mode', startAt: firstStoppedAt, endAt: null },
        ])
        expect(await candidateKeys(machine)).toEqual([])
      },
      { timeout: 5_000 },
    )
    expect(logs.lines()).toEqual([
      ['info', { event: 'run_mode.debounce_tick.start', intervalMs: 1000 }],
      [
        'warn',
        {
          event: 'run_mode.debounce_tick.scan_failed',
          error: expect.stringMatching(/NOPERM.*'scan' command/),
        },
      ],
      ['info', { event: 'run_mode.debounce_tick.scan_recovered' }],
    ])
  }, 20_000)
})
