import '../../../test/contract-setup.js'

import type { Server } from 'node:http'
import express, { type Request, type Response } from 'express'
import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, expect, type MockInstance, vi } from 'vitest'
import { __test__ as subscribers } from '../../../jobs/subscribers.js'
import { stopRefresh, __test__ as tagMap } from '../../../jobs/tag-map.js'
import { logger } from '../../../lib/logger.js'
import { closeRedis, initRedis } from '../../../lib/redis.js'
import { testRedis } from '../../../test/contract-setup.js'
import { PlannedStop } from '../../planned-stop/planned-stop.model.js'
import * as policyService from '../../policy/policy.service.js'
import { bootstrapSystemReasons } from '../../reason/reason.bootstrap.js'
import { Reason } from '../../reason/reason.model.js'
import { UnplannedStop } from '../../unplanned-stop/unplanned-stop.model.js'
import { runDecisionTick } from '../run-mode.debounce-tick.js'
import type { PendingDecision } from '../run-mode.decisions.js'
import { handleRunModeSample } from '../run-mode.processor.js'
import { RunModeProcessingState } from '../run-mode-processing-state.model.js'

// The run-mode outage contract tests share this harness: work-center and telemetry as stub servers,
// the service's own Redis clients, and the fixtures the scenarios are written in

// ── Stub servers: each endpoint answers, fails with 500 or never answers ─────

// not_binary answers 400 historian.binary_only, as telemetry does when asked for the states of a tag
// that is not binary; bad_request answers any other 400
type StubMode = 'answer' | 'fail' | 'hang' | 'not_binary' | 'bad_request'

interface StubEndpoint {
  // For every request, or as each request picks
  mode: StubMode | ((req: Request) => StubMode)
  // null answers 404, as the services do for an unknown work center or tag
  answer: (req: Request) => unknown
}

type Endpoint = 'workCenter' | 'runModeMonitors' | 'latest' | 'stateDurations'

interface StoredSample {
  occurredAt: Date
  value: number
}

// The samples telemetry stored per tag, oldest first: a value only when it changed
export const telemetryHistory = new Map<string, StoredSample[]>()

// state-durations as telemetry computes it (binary.calc.ts, with the validator's default limit of
// 500): the samples in [after ?? from, to), the state before them as the baseline, and while hasMore
// the segment still in progress left out, for the next page to start at nextCursor
export function stateDurations(req: Request) {
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
export function latestSample(req: Request) {
  const tagId = String(req.params.tagId)
  const last = telemetryHistory.get(tagId)?.at(-1)
  return last ? { tagId, value: last.value, occurredAt: last.occurredAt } : null
}

export let stubs: Record<Endpoint, StubEndpoint>
// The requests each endpoint received, as their path parameters and query
export let received: Record<Endpoint, Record<string, unknown>[]>

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
export const held = new Set<Response>()

// A hanging endpoint answers the requests it holds at last: those `which` picks, or all of them
export function releaseHeld(
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
    const { mode: modeOf, answer } = stubs[endpoint]
    const mode = typeof modeOf === 'function' ? modeOf(req) : modeOf
    if (mode === 'hang') {
      held.add(res)
      return
    }
    if (mode === 'fail') {
      res.status(500).json({ error: { code: 'error.internal', message: 'Internal error' } })
      return
    }
    if (mode === 'not_binary') {
      res.status(400).json({
        error: { code: 'historian.binary_only', message: 'Only binary tags have states' },
      })
      return
    }
    if (mode === 'bad_request') {
      res.status(400).json({ error: { code: 'error.validation', message: 'Invalid query' } })
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
  tagMap.workCenterByTag.clear()
  // contract-setup wipes MongoDB and flushes Redis after every test
  await bootstrapSystemReasons()
})

afterEach(async () => {
  // No refresh or reconciliation of the tag map goes on into the next test
  await stopRefresh()
  for (const res of held) res.destroy()
  held.clear()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

export const userId = new Types.ObjectId().toString()

// A clock time of one day in UTC, as the scenarios write it
export const at = (time: string): Date => new Date(`2026-06-15T${time}.000Z`)

export interface Machine {
  workCenterId: string
  runModeTagId: string
}

export async function machineWithDebounce(debounceMs: number): Promise<Machine> {
  const workCenterId = new Types.ObjectId().toString()
  await policyService.upsertForWorkCenter(workCenterId, { runModeDebounceMs: debounceMs }, userId)
  return { workCenterId, runModeTagId: new Types.ObjectId().toString() }
}

// A run-mode value stamped with the machine's own time, as the telemetry subscriber passes it on
export async function signal(machine: Machine, value: number, time: string): Promise<void> {
  await handleRunModeSample({ ...machine, value, occurredAt: at(time) })
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
export function recorded(machine: Machine, value: number, time: string): RecordedValue {
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
export function deliver(machine: Machine, event: RecordedValue): Promise<void> {
  tagMap.workCenterByTag.set(machine.runModeTagId, machine.workCenterId)
  return subscribers.streams['events.telemetry']['tag.value.recorded'](event)
}

export async function stopsOf(machine: Machine) {
  const stops = await UnplannedStop.find({ workCenterId: new Types.ObjectId(machine.workCenterId) })
    .sort({ startAt: 1 })
    .lean()
  return stops.map(({ source, startAt, endAt }) => ({ source, startAt, endAt }))
}

export const runModeStop = (from: string, to: string) => ({
  source: 'run_mode',
  startAt: at(from),
  endAt: at(to),
})

// Redis read directly, under the key prefix the tick scans
export const candidateKey = (machine: Machine): string =>
  `performance:runmode:candidate:${machine.workCenterId}:${machine.runModeTagId}`

export function candidateKeys(machine: Machine): Promise<string[]> {
  return testRedis.keys(`performance:runmode:candidate:${machine.workCenterId}:*`)
}

export async function storedCandidate(machine: Machine): Promise<PendingDecision | null> {
  const raw = await testRedis.get(candidateKey(machine))
  return raw === null ? null : (JSON.parse(raw) as PendingDecision)
}

// A record is pending from the server's time of its write, which most scenarios leave open: without
// that time, a fixture matches any time in ISO 8601 UTC, so a record written from one passes it
const pendingFrom = (time?: string | Date): string =>
  time === undefined
    ? expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    : (typeof time === 'string' ? at(time) : time).toISOString()

// The candidate rule 1 writes for a stop at the given time, D = 60 s
export const candidateSince = (time: string, pendingSince?: string | Date): PendingDecision => ({
  kind: 'debounce',
  since: at(time).toISOString(),
  pendingSince: pendingFrom(pendingSince),
  debounceMs: 60_000,
  attempts: 0,
  nextAttemptAt: null,
})

export function seedReason(usage: 'planned_stop' | 'unplanned_stop') {
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

export const cursorOf = (machine: Machine) =>
  RunModeProcessingState.findOne({ workCenterId: new Types.ObjectId(machine.workCenterId) }).lean()

// Redis answers one command with an error while it keeps serving the rest: the user the service
// connects as loses the command until fn is done
export async function whileRedisRefuses<T>(command: string, fn: () => Promise<T>): Promise<T> {
  await testRedis.call('ACL', 'SETUSER', 'default', `-${command}`)
  try {
    return await fn()
  } finally {
    await testRedis.call('ACL', 'SETUSER', 'default', `+${command}`)
  }
}

// The decision tick, as production runs it every second, at a time of the server's clock
export const tick = (time: string) => runDecisionTick(at(time))

// Runs fn while the server's clock reads the given time, for a scenario that says when a record is
// written: a pending decision counts its 24 hours from the time it was written
export async function atServerTime<T>(time: Date, fn: () => Promise<T>): Promise<T> {
  vi.setSystemTime(time)
  try {
    return await fn()
  } finally {
    vi.useRealTimers()
  }
}

export const openRunModeStop = (from: string) => ({
  source: 'run_mode',
  startAt: at(from),
  endAt: null,
})

// The check a planned stop that closed at the given time leaves when the run mode cannot be read
export const afterPlannedSince = (time: string, pendingSince?: string | Date): PendingDecision => ({
  kind: 'after_planned',
  since: at(time).toISOString(),
  pendingSince: pendingFrom(pendingSince),
  debounceMs: 0,
  attempts: 0,
  nextAttemptAt: null,
})

export async function storedCheck(machine: Machine): Promise<PendingDecision | null> {
  const raw = await testRedis.get(
    `performance:runmode:after-planned:${machine.workCenterId}:${machine.runModeTagId}`,
  )
  return raw === null ? null : (JSON.parse(raw) as PendingDecision)
}

export async function activePlannedStop(machine: Machine, from: string, to: string) {
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

export const closePlannedStop = (plannedStopId: Types.ObjectId, time: string) =>
  PlannedStop.updateOne(
    { _id: plannedStopId },
    { $set: { status: 'closed', actualEndAt: at(time) } },
  )

// Every line the service logs at warn and error, and its info lines about pending decisions, the
// tick that decides them, the boot reconciliation and the tag map, in order, with the level of each
// line. The lines are kept out of the output: a test asserts the lines it expects instead of printing
// them
export function watchDecisionLogs() {
  const spies = (['info', 'warn', 'error'] as const).map(level => {
    const spy: MockInstance = vi.spyOn(logger, level).mockImplementation(() => logger)
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
            level !== 'info' ||
            /^run_mode\.(decision|debounce_tick|reconciler|tag_map)\./.test(String(meta?.event)),
        )
        .sort((a, b) => a.order - b.order)
        .map(({ level, meta }) => [level, meta]),
    restore: () => {
      for (const { spy } of spies) spy.mockRestore()
    },
  }
}
