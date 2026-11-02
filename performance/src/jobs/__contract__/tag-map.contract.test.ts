import '../../test/contract-setup.js'

import { setTimeout as sleep } from 'node:timers/promises'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  afterPlannedSince,
  at,
  candidateSince,
  cursorOf,
  deliver,
  held,
  latestSample,
  type Machine,
  machineWithDebounce,
  received,
  recorded,
  releaseHeld,
  stopsOf,
  storedCandidate,
  storedCheck,
  stubs,
  watchDecisionLogs,
} from '../../modules/run-mode/__contract__/run-mode-outage.harness.js'
import { leaveAfterPlannedCheck } from '../../modules/run-mode/run-mode.processor.js'
import { RunModeProcessingState } from '../../modules/run-mode/run-mode-processing-state.model.js'
import { __test__ as subscribers } from '../subscribers.js'
import {
  requestRefresh,
  seedFromCursors,
  stopRefresh,
  __test__ as tagMap,
  workCenterForTag,
} from '../tag-map.js'

// ── Work-center as the stub answers it ───────────────────────────────────────

interface WorkCenterRecord {
  status: 'active' | 'archived'
  runModeTagId?: string
}

// Work-center's records: its work center endpoint and its monitor list both answer from them
const workCenters = new Map<string, WorkCenterRecord>()

// Work-center binds the machine's run-mode tag to its work center
function bind(machine: Machine, status: WorkCenterRecord['status'] = 'active'): void {
  workCenters.set(machine.workCenterId, { status, runModeTagId: machine.runModeTagId })
}

// Work-center removes the run-mode tag from the machine's work center
function unbind(machine: Machine): void {
  workCenters.set(machine.workCenterId, { status: 'active' })
}

function workCenterDown(): void {
  stubs.workCenter.mode = 'fail'
  stubs.runModeMonitors.mode = 'fail'
}

function workCenterBack(): void {
  stubs.workCenter.mode = 'answer'
  stubs.runModeMonitors.mode = 'answer'
}

// The same machine once work-center binds another run-mode tag to it
const withNewTag = (machine: Machine): Machine => ({
  ...machine,
  runModeTagId: new Types.ObjectId().toString(),
})

// ── The stream and what performance stored ───────────────────────────────────

type WorkCenterEvent = keyof (typeof subscribers.streams)['events.work_center']

const workCenterEvent = (type: WorkCenterEvent, machine: Machine): Promise<void> =>
  subscribers.streams['events.work_center'][type]({ workCenterId: machine.workCenterId })

// The stream hands a recorded value to the subscriber, which finds its work center in the tag map
const arrives = subscribers.streams['events.telemetry']['tag.value.recorded']

// Every cursor of the machine's work center, whichever tag it names
async function cursorsOf(machine: Machine) {
  const cursors = await RunModeProcessingState.find({
    workCenterId: new Types.ObjectId(machine.workCenterId),
  }).lean()
  return cursors.map(c => ({
    runModeTagId: c.runModeTagId.toString(),
    lastProcessedOccurredAt: c.lastProcessedOccurredAt,
  }))
}

const cursorAt = (machine: Machine, time: string) => ({
  runModeTagId: machine.runModeTagId,
  lastProcessedOccurredAt: at(time),
})

// Every request telemetry received about the tag
const telemetryAskedAbout = (tagId: string) =>
  [...received.latest, ...received.stateDurations].filter(request => request.tagId === tagId)

// The time by which work-center had been asked for the monitor list so many times
async function listed(times: number): Promise<number> {
  await vi.waitFor(() => expect(received.runModeMonitors).toHaveLength(times), {
    timeout: 5_000,
    interval: 10,
  })
  return Date.now()
}

// ── Log lines ────────────────────────────────────────────────────────────────

const workCenterFetchFailed = (machine: Machine) => [
  'warn',
  {
    event: 'internal_api.work_center.fetch_failed',
    status: 500,
    workCenterId: machine.workCenterId,
  },
]

const refreshFailed = [
  'warn',
  {
    event: 'run_mode.tag_map.refresh_failed',
    error: 'error.work_center_unreachable',
    cause: 'HTTP 500',
  },
]

const refreshRecovered = (attempts: number) => [
  'info',
  { event: 'run_mode.tag_map.refresh_recovered', attempts },
]

const unmonitored = (machine: Machine) => [
  'info',
  {
    event: 'run_mode.tag_map.unmonitored',
    workCenterId: machine.workCenterId,
    runModeTagId: machine.runModeTagId,
  },
]

let logs: ReturnType<typeof watchDecisionLogs>

beforeEach(() => {
  workCenters.clear()
  stubs.workCenter.answer = req => {
    const record = workCenters.get(String(req.params.id))
    if (!record) return null
    return {
      _id: String(req.params.id),
      type: 'physical',
      status: record.status,
      tagBindings: record.runModeTagId ? { runModeTagId: record.runModeTagId } : {},
    }
  }
  stubs.runModeMonitors.answer = () =>
    [...workCenters]
      .filter(([, record]) => record.status === 'active' && record.runModeTagId)
      .map(([workCenterId, record]) => ({ workCenterId, runModeTagId: record.runModeTagId }))
  logs = watchDecisionLogs()
})

afterEach(async () => {
  // No refresh or reconciliation goes on into the next test, nor logs after the watch ends
  await stopRefresh()
  logs.restore()
})

// ── Scenario 9: work-center is down on work_center.updated ───────────────────

describe('The tag map when work-center cannot answer an update (scenario 9)', () => {
  it('keeps the mapping when work-center cannot answer an update', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    await deliver(machine, recorded(machine, 1, '10:00:00'))
    workCenterDown()

    // The event is acknowledged: its handler does not fail, so the stream neither redelivers it
    // nor dead-letters it
    await expect(workCenterEvent('work_center.updated', machine)).resolves.toBeUndefined()

    expect(workCenterForTag(machine.runModeTagId)).toBe(machine.workCenterId)
    // Its signals keep being processed
    await arrives(recorded(machine, 0, '10:05:00'))
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:05:00'))
    // A full refresh was requested; it fails while work-center is down
    await vi.waitFor(() => expect(logs.lines()).toContainEqual(refreshFailed))
    expect(logs.lines()).toEqual([workCenterFetchFailed(machine), refreshFailed])
  })

  it('updates the mapping and reconciles once work-center answers again', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    await deliver(machine, recorded(machine, 1, '10:00:00'))
    await deliver(machine, recorded(machine, 0, '10:05:00'))
    workCenterDown()
    // Work-center binds another run-mode tag while performance cannot read it; telemetry stored
    // that tag's stop at 10:06
    const moved = withNewTag(machine)
    bind(moved)
    recorded(moved, 0, '10:06:00')

    await workCenterEvent('work_center.updated', machine)
    await listed(1)
    expect(workCenterForTag(machine.runModeTagId)).toBe(machine.workCenterId)
    expect(workCenterForTag(moved.runModeTagId)).toBeUndefined()
    workCenterBack()

    // The refresh asks again 1 s after its first failure
    await vi.waitFor(
      () => expect(workCenterForTag(moved.runModeTagId)).toBe(machine.workCenterId),
      { timeout: 3_000 },
    )
    expect(workCenterForTag(machine.runModeTagId)).toBeUndefined()
    // Reconciled from the new tag's latest sample; the old tag's cursor and candidate are gone
    await vi.waitFor(async () =>
      expect(await cursorsOf(machine)).toEqual([cursorAt(moved, '10:06:00')]),
    )
    expect(await storedCandidate(moved)).toEqual(candidateSince('10:06:00'))
    expect(await storedCandidate(machine)).toBeNull()
    expect(logs.lines()).toEqual([
      workCenterFetchFailed(machine),
      refreshFailed,
      unmonitored(machine),
      refreshRecovered(1),
    ])
  })

  it('runs one refresh at a time while several updates fail', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    await deliver(machine, recorded(machine, 1, '10:00:00'))
    workCenterDown()

    await workCenterEvent('work_center.updated', machine)
    await workCenterEvent('work_center.updated', machine)
    await workCenterEvent('work_center.metric_composition.changed', machine)

    // One loop on the retry schedule: one request at once and the next 1 s later, not one per update
    await sleep(500)
    expect(received.runModeMonitors).toHaveLength(1)
    await listed(2)
    // The updates that came while the refresh ran leave work-center to it
    expect(received.workCenter).toHaveLength(1)
    expect(workCenterForTag(machine.runModeTagId)).toBe(machine.workCenterId)
    expect(logs.lines()).toEqual([workCenterFetchFailed(machine), refreshFailed])
  })

  it('maps a work center that is new to the map and reconciles it', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    // Telemetry stored the machine's stop before work-center named its tag to performance
    recorded(machine, 0, '10:05:00')

    await workCenterEvent('work_center.created', machine)

    expect(workCenterForTag(machine.runModeTagId)).toBe(machine.workCenterId)
    await vi.waitFor(async () =>
      expect(await cursorsOf(machine)).toEqual([cursorAt(machine, '10:05:00')]),
    )
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:05:00'))
    expect(logs.lines()).toEqual([])
  })

  it('moves the mapping to a changed tag and reconciles the work center', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    await deliver(machine, recorded(machine, 1, '10:00:00'))
    const moved = withNewTag(machine)
    bind(moved)
    recorded(moved, 1, '10:02:00')

    await workCenterEvent('work_center.updated', machine)

    expect(workCenterForTag(moved.runModeTagId)).toBe(machine.workCenterId)
    expect(workCenterForTag(machine.runModeTagId)).toBeUndefined()
    // The new tag starts from its latest sample, and the old tag's cursor is gone
    await vi.waitFor(async () =>
      expect(await cursorsOf(machine)).toEqual([cursorAt(moved, '10:02:00')]),
    )
    expect(logs.lines()).toEqual([unmonitored(machine)])
  })

  it('leaves an unchanged tag mapped without reconciling it again', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    await deliver(machine, recorded(machine, 1, '10:00:00'))
    // A reconciliation would replay this stop from telemetry
    recorded(machine, 0, '10:05:00')

    await workCenterEvent('work_center.updated', machine)
    await sleep(300)

    expect(workCenterForTag(machine.runModeTagId)).toBe(machine.workCenterId)
    expect(telemetryAskedAbout(machine.runModeTagId)).toEqual([])
    expect(await cursorsOf(machine)).toEqual([cursorAt(machine, '10:00:00')])
    expect(await storedCandidate(machine)).toBeNull()
    expect(logs.lines()).toEqual([])
  })

  it('retries the reconciliation of a new work center until telemetry answers', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    recorded(machine, 0, '10:05:00')
    stubs.latest.mode = 'fail'

    await workCenterEvent('work_center.created', machine)
    await vi.waitFor(() => expect(received.latest).toHaveLength(1))
    stubs.latest.mode = 'answer'

    // Asked again 1 s after its first failure
    await vi.waitFor(
      async () => expect(await storedCandidate(machine)).toEqual(candidateSince('10:05:00')),
      { timeout: 3_000 },
    )
    expect(received.latest).toHaveLength(2)
    // Its first failure, with the cause, and its recovery; its requests log at debug
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'run_mode.reconciler.failed',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          error: 'error.telemetry_unreachable',
          cause: 'HTTP 500',
        },
      ],
      [
        'info',
        {
          event: 'run_mode.reconciler.recovered',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          attempts: 1,
        },
      ],
    ])
  })
})

// ── Scenario 10: work-center is down at startup ──────────────────────────────

describe('The tag map at startup while work-center cannot answer (scenario 10)', () => {
  it('retries the monitor list at startup until it arrives', async () => {
    // Performance processed this machine's signals before it restarted
    const known = await machineWithDebounce(60_000)
    bind(known)
    await deliver(known, recorded(known, 1, '10:00:00'))
    // Work-center bound this one while performance was down, and telemetry stored its stop
    const unseen = await machineWithDebounce(60_000)
    bind(unseen)
    recorded(unseen, 0, '10:05:00')
    // Performance restarts while work-center is down
    tagMap.workCenterByTag.clear()
    workCenterDown()

    await seedFromCursors()
    requestRefresh()
    const first = await listed(1)

    // Mapped from its cursor, so its signals are processed while the list is retried
    expect(workCenterForTag(known.runModeTagId)).toBe(known.workCenterId)
    expect(workCenterForTag(unseen.runModeTagId)).toBeUndefined()
    await arrives(recorded(known, 0, '10:07:00'))
    expect(await storedCandidate(known)).toEqual(candidateSince('10:07:00'))

    const second = await listed(2)
    workCenterBack()
    const third = await listed(3)

    // 1 s after the first failure, 2 s after the second
    expect(second - first).toBeGreaterThanOrEqual(950)
    expect(second - first).toBeLessThan(2_000)
    expect(third - second).toBeGreaterThanOrEqual(1_950)
    expect(third - second).toBeLessThan(4_000)
    // The work center without a cursor is mapped and reconciled
    await vi.waitFor(() => expect(workCenterForTag(unseen.runModeTagId)).toBe(unseen.workCenterId))
    await vi.waitFor(async () =>
      expect(await cursorsOf(unseen)).toEqual([cursorAt(unseen, '10:05:00')]),
    )
    expect(await storedCandidate(unseen)).toEqual(candidateSince('10:05:00'))
    // The known one keeps its tag and is not reconciled again: boot reconciliation replays it
    expect(workCenterForTag(known.runModeTagId)).toBe(known.workCenterId)
    expect(telemetryAskedAbout(known.runModeTagId)).toEqual([])
    expect(logs.lines()).toEqual([refreshFailed, refreshRecovered(2)])
  }, 15_000)
})

// ── Review focus 3: the run-mode tag changes while a decision is pending ─────

describe('Pending decisions of a tag that changed (review focus 3)', () => {
  it('drops pending decisions of a tag that changed', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    await leaveAfterPlannedCheck(machine, at('09:30:00'))
    const unchanged = await machineWithDebounce(60_000)
    bind(unchanged)
    await deliver(unchanged, recorded(unchanged, 0, '10:00:00'))
    await leaveAfterPlannedCheck(unchanged, at('09:30:00'))
    const moved = withNewTag(machine)
    bind(moved)

    await workCenterEvent('work_center.updated', machine)
    await workCenterEvent('work_center.updated', unchanged)

    // The old tag never decides for the machine: its candidate, check and cursor are gone
    expect(await storedCandidate(machine)).toBeNull()
    expect(await storedCheck(machine)).toBeNull()
    expect(await cursorsOf(machine)).toEqual([])
    // A tag that did not change keeps its pending decisions
    expect(await storedCandidate(unchanged)).toEqual(candidateSince('10:00:00'))
    expect(await storedCheck(unchanged)).toEqual(afterPlannedSince('09:30:00'))
    expect(await cursorsOf(unchanged)).toEqual([cursorAt(unchanged, '10:00:00')])
    expect(logs.lines()).toEqual([unmonitored(machine)])
  })
})

// ── A work center that stops being monitored ─────────────────────────────────

describe('A work center that stops being monitored loses its run-mode state', () => {
  it('does not replay the time a work center was unbound once it is bound again', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    await deliver(machine, recorded(machine, 1, '10:00:00'))

    unbind(machine)
    await workCenterEvent('work_center.updated', machine)
    expect(workCenterForTag(machine.runModeTagId)).toBeUndefined()
    expect(await cursorsOf(machine)).toEqual([])

    // The machine stops and runs again while it is not monitored: its signals reach no rule
    await arrives(recorded(machine, 0, '10:05:00'))
    await arrives(recorded(machine, 1, '10:10:00'))

    // Bound again, monitoring starts from the latest sample
    bind(machine)
    await workCenterEvent('work_center.updated', machine)
    await vi.waitFor(async () =>
      expect(await cursorsOf(machine)).toEqual([cursorAt(machine, '10:10:00')]),
    )
    // The next signal follows the latest sample, so nothing is replayed
    await arrives(recorded(machine, 0, '10:30:00'))

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:30:00'))
    expect(received.stateDurations).toEqual([])
    expect(logs.lines()).toEqual([unmonitored(machine)])
  })

  it.each([
    ['archived', 'work_center.archived', (machine: Machine) => bind(machine, 'archived')],
    [
      'deleted',
      'work_center.deleted',
      (machine: Machine) => workCenters.delete(machine.workCenterId),
    ],
  ] as const)('forgets a work center that is %s', async (_, event, change) => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    change(machine)

    await workCenterEvent(event, machine)

    expect(workCenterForTag(machine.runModeTagId)).toBeUndefined()
    expect(await storedCandidate(machine)).toBeNull()
    expect(await cursorsOf(machine)).toEqual([])
    expect(logs.lines()).toEqual([unmonitored(machine)])
  })

  it('forgets a work center the monitor list no longer names', async () => {
    const kept = await machineWithDebounce(60_000)
    bind(kept)
    await deliver(kept, recorded(kept, 0, '10:00:00'))
    const dropped = await machineWithDebounce(60_000)
    bind(dropped)
    await deliver(dropped, recorded(dropped, 0, '10:00:00'))
    // Archived while performance could not read work-center
    bind(dropped, 'archived')

    requestRefresh()

    await vi.waitFor(() => expect(workCenterForTag(dropped.runModeTagId)).toBeUndefined())
    await vi.waitFor(() => expect(logs.lines()).toEqual([unmonitored(dropped)]))
    expect(await storedCandidate(dropped)).toBeNull()
    expect(await cursorsOf(dropped)).toEqual([])
    // The other work center keeps its tag and state, and is not reconciled again
    expect(workCenterForTag(kept.runModeTagId)).toBe(kept.workCenterId)
    expect(await storedCandidate(kept)).toEqual(candidateSince('10:00:00'))
    expect(await cursorsOf(kept)).toEqual([cursorAt(kept, '10:00:00')])
    expect(telemetryAskedAbout(kept.runModeTagId)).toEqual([])
  })

  it('cancels the reconciliation of a tag that stops being monitored before it forgets the tag', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    recorded(machine, 0, '10:05:00')
    stubs.latest.mode = 'hang'
    await workCenterEvent('work_center.created', machine)
    await vi.waitFor(() => expect(held.size).toBe(1))

    // Unbound before telemetry answers the reconciliation
    unbind(machine)
    await workCenterEvent('work_center.updated', machine)
    releaseHeld(res => res.json({ data: latestSample(res.req) }))
    await sleep(500)

    expect(workCenterForTag(machine.runModeTagId)).toBeUndefined()
    expect(await storedCandidate(machine)).toBeNull()
    expect(await cursorsOf(machine)).toEqual([])
    expect(logs.lines()).toEqual([unmonitored(machine)])
  })
})

// ── Shutdown ──────────────────────────────────────────────────────────────────

describe('The tag map at shutdown', () => {
  it('starts no refresh attempt once stopped', async () => {
    workCenterDown()
    requestRefresh()
    await vi.waitFor(() => expect(logs.lines()).toContainEqual(refreshFailed))

    const stoppingAt = Date.now()
    await stopRefresh()
    workCenterBack()

    // Shutdown did not wait for the next attempt's time
    expect(Date.now() - stoppingAt).toBeLessThan(500)
    // Past the moment the next attempt was due
    await sleep(1_500)
    expect(received.runModeMonitors).toHaveLength(1)
    expect(logs.lines()).toEqual([refreshFailed])
  })

  it('aborts a reconciliation in flight and writes nothing once stopped', async () => {
    const machine = await machineWithDebounce(60_000)
    bind(machine)
    recorded(machine, 0, '10:05:00')
    stubs.latest.mode = 'hang'
    await workCenterEvent('work_center.created', machine)
    await vi.waitFor(() => expect(held.size).toBe(1))

    const stoppingAt = Date.now()
    await stopRefresh()

    // Shutdown did not wait for telemetry's answer or for the request's 5 s timeout
    expect(Date.now() - stoppingAt).toBeLessThan(1_000)
    // Telemetry answers once the data connections would have closed
    releaseHeld(res => res.json({ data: latestSample(res.req) }))
    await sleep(500)
    expect(await storedCandidate(machine)).toBeNull()
    expect(await cursorOf(machine)).toBeNull()
    expect(logs.lines()).toEqual([])
  })
})
