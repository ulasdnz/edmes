import '../../../test/contract-setup.js'

import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlannedStop } from '../../planned-stop/planned-stop.model.js'
import {
  reconcileWorkCenter,
  startBootReconciliation,
  stopBootReconciliation,
} from '../run-mode.reconciler.js'
import {
  at,
  candidateSince,
  cursorOf,
  deliver,
  held,
  type Machine,
  machineWithDebounce,
  received,
  recorded,
  releaseHeld,
  stateDurations,
  stopsOf,
  storedCandidate,
  stubs,
  watchDecisionLogs,
} from './run-mode-outage.harness.js'

let logs: ReturnType<typeof watchDecisionLogs>

beforeEach(() => {
  logs = watchDecisionLogs()
})

afterEach(async () => {
  // No reconciliation goes on into the next test
  await stopBootReconciliation()
  logs.restore()
})

// A machine performance last saw running at 10:00 and that stopped at 10:05 while performance was
// down: telemetry stored the stop, performance never received it
async function stoppedWhilePerformanceWasDown(): Promise<Machine> {
  const machine = await machineWithDebounce(60_000)
  await deliver(machine, recorded(machine, 1, '10:00:00'))
  recorded(machine, 0, '10:05:00')
  return machine
}

// The requests telemetry received for the machine's history
const historyRequestsOf = (machine: Machine) =>
  received.stateDurations.filter(request => request.tagId === machine.runModeTagId)

// The time by which telemetry had been asked for the machine's history so many times
async function askedFor(machine: Machine, times: number): Promise<number> {
  await vi.waitFor(() => expect(historyRequestsOf(machine)).toHaveLength(times), {
    timeout: 5_000,
    interval: 10,
  })
  return Date.now()
}

const reconcilerStarted = (count: number) => ['info', { event: 'run_mode.reconciler.start', count }]

const reconcilerDone = ['info', { event: 'run_mode.reconciler.done' }]

const reconcilerFailed = (machine: Machine, cause: string) => [
  'warn',
  {
    event: 'run_mode.reconciler.failed',
    workCenterId: machine.workCenterId,
    runModeTagId: machine.runModeTagId,
    error: 'error.telemetry_unreachable',
    cause,
  },
]

// ── Scenario 10: telemetry is down at boot ───────────────────────────────────

describe('Boot reconciliation retries each work center until telemetry answers (scenario 10)', () => {
  it('fails when telemetry cannot answer, and leaves the log line to its caller', async () => {
    const replaying = await stoppedWhilePerformanceWasDown()
    const unseen = await machineWithDebounce(60_000)
    recorded(unseen, 0, '10:05:00')
    stubs.stateDurations.mode = 'fail'
    stubs.latest.mode = 'fail'

    // With a cursor the history since it is replayed; without one the latest sample is read
    await expect(reconcileWorkCenter(replaying, at('10:10:00'))).rejects.toThrow(
      'error.telemetry_unreachable',
    )
    await expect(reconcileWorkCenter(unseen, at('10:10:00'))).rejects.toThrow(
      'error.telemetry_unreachable',
    )

    expect(await storedCandidate(replaying)).toBeNull()
    expect((await cursorOf(replaying))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))
    expect(await storedCandidate(unseen)).toBeNull()
    expect(await cursorOf(unseen)).toBeNull()
    // Its caller logs the failure once, with the cause; the requests log theirs at debug
    expect(logs.lines()).toEqual([])
  })

  it('retries a work center until telemetry answers', async () => {
    const machine = await stoppedWhilePerformanceWasDown()
    stubs.stateDurations.mode = 'fail'

    await startBootReconciliation()
    const first = await askedFor(machine, 1)
    const second = await askedFor(machine, 2)
    // Telemetry is back for the third attempt
    stubs.stateDurations.mode = 'answer'
    const third = await askedFor(machine, 3)

    // 1 s after the first failure, 2 s after the second
    expect(second - first).toBeGreaterThanOrEqual(950)
    expect(second - first).toBeLessThan(2_000)
    expect(third - second).toBeGreaterThanOrEqual(1_950)
    expect(third - second).toBeLessThan(4_000)
    await vi.waitFor(async () =>
      expect(await storedCandidate(machine)).toEqual(candidateSince('10:05:00')),
    )
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:05:00'))
    await vi.waitFor(() => expect(logs.lines()).toContainEqual(reconcilerDone))
    expect(logs.lines()).toEqual([
      reconcilerStarted(1),
      reconcilerFailed(machine, 'HTTP 500'),
      [
        'info',
        {
          event: 'run_mode.reconciler.recovered',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          attempts: 2,
        },
      ],
      reconcilerDone,
    ])
  }, 15_000)

  it('lets startup go on while telemetry does not answer', async () => {
    const machine = await stoppedWhilePerformanceWasDown()
    stubs.stateDurations.mode = 'hang'

    const startedAt = Date.now()
    await startBootReconciliation()

    // Startup did not wait for telemetry, which has not answered yet
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    await vi.waitFor(() => expect(held.size).toBe(1))
    expect(await storedCandidate(machine)).toBeNull()

    releaseHeld(res => res.json({ data: stateDurations(res.req) }))

    await vi.waitFor(async () =>
      expect(await storedCandidate(machine)).toEqual(candidateSince('10:05:00')),
    )
    await vi.waitFor(() => expect(logs.lines()).toEqual([reconcilerStarted(1), reconcilerDone]))
  })

  it('reconciles a work center at once while another keeps failing', async () => {
    // Listed first, so reconciling one work center after another would hold the second up
    const failing = await stoppedWhilePerformanceWasDown()
    const answering = await stoppedWhilePerformanceWasDown()
    stubs.stateDurations.mode = req =>
      req.params.tagId === failing.runModeTagId ? 'fail' : 'answer'

    await startBootReconciliation()

    await vi.waitFor(async () =>
      expect(await storedCandidate(answering)).toEqual(candidateSince('10:05:00')),
    )
    // Asked again 1 s after its first failure, and it fails again
    await askedFor(failing, 2)
    expect(historyRequestsOf(answering)).toHaveLength(1)
    expect(await storedCandidate(failing)).toBeNull()
    expect(logs.lines()).toEqual([reconcilerStarted(2), reconcilerFailed(failing, 'HTTP 500')])
  })
})

// ── Shutdown ──────────────────────────────────────────────────────────────────

describe('Boot reconciliation at shutdown', () => {
  it('starts no retry once stopped', async () => {
    const machine = await stoppedWhilePerformanceWasDown()
    stubs.stateDurations.mode = 'fail'

    await startBootReconciliation()
    // The first attempt failed, and the retry waits for its time
    await vi.waitFor(() =>
      expect(logs.lines()).toContainEqual(reconcilerFailed(machine, 'HTTP 500')),
    )
    const stoppingAt = Date.now()
    await stopBootReconciliation()
    stubs.stateDurations.mode = 'answer'

    // Shutdown did not wait for the retry's time
    expect(Date.now() - stoppingAt).toBeLessThan(500)

    // Past the moment the retry was due
    await sleep(1_500)
    expect(historyRequestsOf(machine)).toHaveLength(1)
    expect(await storedCandidate(machine)).toBeNull()
    expect(logs.lines()).toEqual([reconcilerStarted(1), reconcilerFailed(machine, 'HTTP 500')])
  })

  it('aborts a request in flight and writes nothing once stopped', async () => {
    const machine = await stoppedWhilePerformanceWasDown()
    stubs.stateDurations.mode = 'hang'
    await startBootReconciliation()
    await vi.waitFor(() => expect(held.size).toBe(1))

    const stoppingAt = Date.now()
    await stopBootReconciliation()

    // Shutdown did not wait for telemetry's answer or for the request's 5 s timeout
    expect(Date.now() - stoppingAt).toBeLessThan(1_000)
    // Telemetry answers once the data connections would have closed
    releaseHeld(res => res.json({ data: stateDurations(res.req) }))
    await sleep(500)
    expect(await storedCandidate(machine)).toBeNull()
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))
    expect(historyRequestsOf(machine)).toHaveLength(1)
    expect(logs.lines()).toEqual([reconcilerStarted(1)])
  })

  it('stops between two samples and waits for the one being written', async () => {
    const machine = await stoppedWhilePerformanceWasDown()
    // ...and ran again at 10:10, which performance never received either
    recorded(machine, 1, '10:10:00')
    // Shutdown begins while the replay writes its first sample, as rule 1 reads the planned stops,
    // and that read answers only once the test lets it
    const find = PlannedStop.find.bind(PlannedStop) as (...args: unknown[]) => {
      exec: () => Promise<unknown>
    }
    let letItAnswer = (): void => {}
    const answering = new Promise<void>(resolve => {
      letItAnswer = resolve
    })
    let stopping: Promise<void> | undefined
    const spy = vi.spyOn(PlannedStop, 'find').mockImplementation(((...args: unknown[]) => {
      const query = find(...args)
      if (!stopping) {
        stopping = stopBootReconciliation()
        const exec = query.exec.bind(query)
        query.exec = async () => {
          await answering
          return exec()
        }
      }
      return query
    }) as never)
    try {
      await startBootReconciliation()
      await vi.waitFor(() => expect(stopping).toBeDefined())
      let stopped = false
      void stopping?.then(() => {
        stopped = true
      })

      // The stop waits while the sample is being written
      await sleep(100)
      expect(stopped).toBe(false)
    } finally {
      letItAnswer()
      spy.mockRestore()
    }
    await stopping

    // The stopped sample was written, and the running one after it was not replayed
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:05:00'))
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:05:00'))
    expect(await stopsOf(machine)).toEqual([])
    expect(historyRequestsOf(machine)).toHaveLength(1)
    expect(logs.lines()).toEqual([reconcilerStarted(1)])
  })
})
