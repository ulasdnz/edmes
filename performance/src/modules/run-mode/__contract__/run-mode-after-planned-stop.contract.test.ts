import '../../../test/contract-setup.js'

import mongoose, { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testRedis } from '../../../test/contract-setup.js'
import { PlannedStop } from '../../planned-stop/planned-stop.model.js'
import * as plannedStopService from '../../planned-stop/planned-stop.service.js'
import { Reason } from '../../reason/reason.model.js'
import * as unplannedStopService from '../../unplanned-stop/unplanned-stop.service.js'
import { runDecisionTick } from '../run-mode.debounce-tick.js'
import { RunModeProcessingState } from '../run-mode-processing-state.model.js'
import {
  activePlannedStop,
  afterPlannedSince,
  at,
  candidateSince,
  closePlannedStop,
  deliver,
  held,
  latestSample,
  type Machine,
  machineWithDebounce,
  openRunModeStop,
  recorded,
  releaseHeld,
  runModeStop,
  seedReason,
  stateDurations,
  stopsOf,
  storedCandidate,
  storedCheck,
  stubs,
  tick,
  userId,
  watchDecisionLogs,
  whileRedisRefuses,
} from './run-mode-outage.harness.js'

// Work-center names the machine's run-mode tag
function monitoredByWorkCenter(machine: Machine): void {
  stubs.workCenter.answer = () => ({
    _id: machine.workCenterId,
    type: 'physical',
    tagBindings: { runModeTagId: machine.runModeTagId },
  })
}

// A planned stop that closed, planned for one window and run for another, as an operator enters it
async function closedPlannedStop(
  machine: Machine,
  planned: [from: string, to: string],
  ran: [from: string, to: string],
) {
  const reason = await seedReason('planned_stop')
  return PlannedStop.create({
    workCenterId: new Types.ObjectId(machine.workCenterId),
    reasonId: reason._id,
    plannedOwnerId: new Types.ObjectId(userId),
    source: 'manual',
    startMode: 'manual',
    status: 'closed',
    plannedStartAt: at(planned[0]),
    plannedEndAt: at(planned[1]),
    actualStartAt: at(ran[0]),
    actualEndAt: at(ran[1]),
    createdBy: new Types.ObjectId(userId),
  })
}

// An operator records an unplanned stop and converts it into a planned stop, which the conversion
// creates closed, with the stop's own window
async function convertedPlannedStop(machine: Machine, from: string, to: string) {
  const stop = await unplannedStopService.createManual(
    { workCenterId: machine.workCenterId, startAt: at(from), endAt: at(to) },
    userId,
  )
  const code = `R-${new Types.ObjectId().toString()}`
  const reason = await Reason.create({
    code,
    name: code,
    usages: ['planned_stop'],
    canStartManually: false,
    canBeScheduled: false,
    canConvertFromUnplanned: true,
    isSystemDefault: false,
    isActive: true,
    affectsOee: true,
    createdBy: new Types.ObjectId(userId),
  })
  await unplannedStopService.convertToPlanned(
    stop._id.toString(),
    { reasonId: reason._id.toString() },
    userId,
  )
}

// A planned stop that was planned and never started
async function plannedStopNotStarted(machine: Machine, from: string, to: string) {
  const reason = await seedReason('planned_stop')
  return PlannedStop.create({
    workCenterId: new Types.ObjectId(machine.workCenterId),
    reasonId: reason._id,
    plannedOwnerId: new Types.ObjectId(userId),
    source: 'manual',
    startMode: 'manual',
    status: 'planned',
    plannedStartAt: at(from),
    plannedEndAt: at(to),
    createdBy: new Types.ObjectId(userId),
  })
}

// An operator closes the planned stop through the service, at the given end
const closeAt = (planned: { _id: Types.ObjectId }, time: string) =>
  plannedStopService.close(planned._id.toString(), { actualEndAt: at(time) }, userId)

const checkKey = (machine: Machine): string =>
  `performance:runmode:after-planned:${machine.workCenterId}:${machine.runModeTagId}`

// ── Rule 4: a planned stop that closes while the run mode cannot be read ─────

describe('A planned stop that closes while the run mode cannot be read leaves a check (rule 4)', () => {
  let logs: ReturnType<typeof watchDecisionLogs>

  beforeEach(() => {
    logs = watchDecisionLogs()
  })

  afterEach(() => {
    logs.restore()
  })

  it('leaves a check when telemetry cannot be reached after a planned stop', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    stubs.latest.mode = 'fail'

    const closed = await closeAt(planned, '10:30:00')

    expect(closed.status).toBe('closed')
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))
    const ttlSeconds = await testRedis.ttl(checkKey(machine))
    expect(ttlSeconds).toBeGreaterThan(89_900)
    expect(ttlSeconds).toBeLessThanOrEqual(90_000)
    // "Cannot answer" never means "stopped"
    expect(await stopsOf(machine)).toEqual([])
    // The failed request names its cause; the check waits for the tick without a line of its own
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'internal_api.telemetry.fetch_failed',
          path: `/internal/v1/historian/${machine.runModeTagId}/latest`,
          status: 500,
        },
      ],
    ])
  })

  it('finds the run-mode tag from its cursor when work-center cannot be reached', async () => {
    const machine = await machineWithDebounce(60_000)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    // Performance processed the machine's signal, so its cursor names the tag
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    stubs.workCenter.mode = 'fail'

    await closeAt(planned, '10:30:00')

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))
    expect(await stopsOf(machine)).toEqual([])
  })

  it('leaves no check when the run mode can be read', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await deliver(machine, recorded(machine, 0, '10:02:00'))

    await closeAt(planned, '10:30:00')

    // The machine still stands, so its stop opens at the end of the planned stop
    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('leaves a pending debounce candidate of the same tag as it was', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    // The machine stopped before the planned stop began, and telemetry went down before D ran out
    await deliver(machine, recorded(machine, 0, '09:58:00'))
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    stubs.latest.mode = 'fail'

    await closeAt(planned, '10:30:00')

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))
    expect(await storedCandidate(machine)).toEqual(candidateSince('09:58:00'))
  })

  it('logs that the run mode goes unchecked when neither work-center nor a cursor names the tag', async () => {
    const machine = await machineWithDebounce(60_000)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    stubs.workCenter.mode = 'fail'

    const closed = await closeAt(planned, '10:30:00')

    expect(closed.status).toBe('closed')
    expect(await testRedis.keys(`performance:runmode:*:${machine.workCenterId}:*`)).toEqual([])
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'internal_api.work_center.fetch_failed',
          status: 500,
          workCenterId: machine.workCenterId,
        },
      ],
      [
        'warn',
        {
          event: 'planned_stop.run_mode_unmonitored',
          plannedStopId: planned._id.toString(),
          workCenterId: machine.workCenterId,
          actualEndAt: at('10:30:00').toISOString(),
        },
      ],
    ])
  })

  it('completes the close and logs that a stop may be lost when Redis refuses the check', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    stubs.latest.mode = 'fail'

    const closed = await whileRedisRefuses('eval', () => closeAt(planned, '10:30:00'))

    expect(closed.status).toBe('closed')
    expect(await storedCheck(machine)).toBeNull()
    expect(logs.lines()).toEqual([
      ['warn', expect.objectContaining({ event: 'internal_api.telemetry.fetch_failed' })],
      [
        'error',
        {
          event: 'planned_stop.run_mode_check_failed',
          plannedStopId: planned._id.toString(),
          workCenterId: machine.workCenterId,
          actualEndAt: at('10:30:00').toISOString(),
          error: expect.stringMatching(/NOPERM.*'eval' command/),
        },
      ],
    ])
  })
})

describe('A planned stop that closed while telemetry was down is decided once it answers (rule 4)', () => {
  it('records the stop after the planned stop once the tick reads the history', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    // The machine stops during the planned stop, which covers the sample
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    stubs.latest.mode = 'fail'
    stubs.stateDurations.mode = 'fail'

    await closeAt(planned, '10:30:00')
    await tick('10:31:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toMatchObject({
      since: at('10:30:00').toISOString(),
      attempts: 1,
    })

    // Telemetry is back and has stored the machine's running signal from 10:34
    stubs.latest.mode = 'answer'
    stubs.stateDurations.mode = 'answer'
    const running = recorded(machine, 1, '10:34:00')
    await tick('10:40:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:34:00')])
    expect(await storedCheck(machine)).toBeNull()

    // The running signal reaches performance after the decision, and changes nothing
    await deliver(machine, running)

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:34:00')])
  })
})

// ── Rule 4: the close decides only from an answer that saw every processed sample ──

describe('The close opens the stop at its end only when no sample was processed while it asked (rule 4)', () => {
  // A planned stop from 10:00 covers 0@10:02 and closes at E = 10:30. While the close asks telemetry
  // for the latest sample, the running sample is processed; telemetry computed its answer before it
  // stored that sample, so the answer still names 0@10:02
  async function closeAskedWhileRunningArrives(runningAt: string) {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    stubs.latest.mode = 'hang'
    const closing = closeAt(planned, '10:30:00')
    await vi.waitFor(() => expect(held.size).toBe(1))
    const [question] = held
    const answer = latestSample(question.req)

    await deliver(machine, recorded(machine, 1, runningAt))
    releaseHeld(res => res.json({ data: answer }))
    await closing
    return machine
  }

  it('opens no stop from an answer that missed a running signal processed meanwhile, and the check records the stop', async () => {
    const machine = await closeAskedWhileRunningArrives('10:32:00')

    // A stop opened at E now would stay open: no running signal is left to close it
    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:33:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:32:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('records nothing once the check sees the running signal before E that was processed meanwhile', async () => {
    const machine = await closeAskedWhileRunningArrives('10:28:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:33:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toBeNull()
  })
})

// ── Rule 4: the close decides only from the state at its end ─────────────────

// An operator closes the planned stop late, with the end it had: E = 10:30. A sample telemetry stored
// after E says nothing about the state at E
describe('The close decides from the latest sample only when it came at or before the end (rule 4)', () => {
  it('leaves the check when the machine stood at E and ran after it, and the check records the stop', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    await deliver(machine, recorded(machine, 1, '10:35:00'))

    await closeAt(planned, '10:30:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:40:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:35:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('opens no stop at E when the machine ran at E and stopped after it', async () => {
    const machine = await machineWithDebounce(0)
    monitoredByWorkCenter(machine)
    await deliver(machine, recorded(machine, 1, '09:00:00'))
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    // Telemetry has stored the machine's stop at 10:35, which has not reached performance yet
    const stopped = recorded(machine, 0, '10:35:00')

    await closeAt(planned, '10:30:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    // The stopped signal's own rules decide it: the planned stop had closed by 10:35
    await deliver(machine, stopped)
    await tick('10:40:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:35:00')])
    expect(await storedCheck(machine)).toBeNull()
  })
})

describe('The close leaves no stop at an end that another planned stop covers (rule 4)', () => {
  it('opens no stop at E inside a planned stop converted from an unplanned stop', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    // An operator records a stop from 10:20 to 10:45 and converts it into a planned stop
    await convertedPlannedStop(machine, '10:20:00', '10:45:00')

    await closeAt(planned, '10:30:00')

    // The machine still stands, but the converted planned stop covers E, which had not closed by E
    expect(await stopsOf(machine)).toEqual([
      { source: 'manual', startAt: at('10:20:00'), endAt: at('10:45:00') },
    ])
    expect(await storedCheck(machine)).toBeNull()
  })
})

// ── Rule 4: the stops the closed planned stop covered after its end ──────────

describe('The check decides the stops the planned stop covered after its end (rule 4)', () => {
  // While the planned stop over 10:00 to 11:00 was active it covered every sample processed, also
  // those after 10:30; an operator then closes it late, with the end it had, E = 10:30
  async function closedLateAfter(machine: Machine, samples: (readonly [number, string])[]) {
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    for (const [value, time] of samples) await deliver(machine, recorded(machine, value, time))

    expect(await stopsOf(machine)).toEqual([])

    await closeAt(planned, '10:30:00')

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))
  }

  it('opens the stop of a machine that stopped after E and still stands', async () => {
    const machine = await machineWithDebounce(0)
    await closedLateAfter(machine, [
      [0, '10:02:00'],
      [1, '10:30:00'],
      [0, '10:35:00'],
    ])

    await tick('10:40:01')

    // Running at E, so nothing at 10:30; down since 10:35
    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:35:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('leaves the candidate of that stop under a debounce, and the tick confirms it', async () => {
    const machine = await machineWithDebounce(60_000)
    await closedLateAfter(machine, [
      [0, '10:02:00'],
      [1, '10:30:00'],
      [0, '10:35:00'],
    ])

    await tick('10:40:01')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toEqual(candidateSince('10:35:00'))

    await tick('10:40:02')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:35:00')])
    expect(await storedCandidate(machine)).toBeNull()
  })

  it('records a stop after E that outlasted the debounce, and nothing for a shorter one', async () => {
    const machine = await machineWithDebounce(60_000)
    await closedLateAfter(machine, [
      [0, '10:02:00'],
      [1, '10:30:00'],
      [0, '10:31:00'],
      [1, '10:31:30'],
      [0, '10:33:00'],
      [1, '10:38:00'],
    ])

    await tick('10:40:01')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:33:00', '10:38:00')])
    expect(await storedCandidate(machine)).toBeNull()
  })

  it('decides nothing for a stop after E that another planned stop covers', async () => {
    const machine = await machineWithDebounce(0)
    await plannedStopNotStarted(machine, '10:41:00', '10:55:00')
    await closedLateAfter(machine, [
      [0, '10:02:00'],
      [1, '10:30:00'],
      [0, '10:33:00'],
      [1, '10:38:00'],
      [0, '10:42:00'],
    ])

    await tick('10:45:01')

    // The machine has stood since 10:42, inside the window of the planned stop over 10:41 to 10:55
    expect(await stopsOf(machine)).toEqual([runModeStop('10:33:00', '10:38:00')])
  })

  it('takes a stop that ends the first page of a long history as ended where the machine ran', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    // A clock time this many seconds after E = 10:30
    const afterEnd = (seconds: number) =>
      new Date(at('10:30:00').getTime() + seconds * 1000).toISOString().slice(11, 19)
    // More samples after E than a page of history holds (500): stops and runs of a second each, a
    // stop of two minutes from 10:38:19, and a stop at 10:41:40 on the next page
    recorded(machine, 1, '09:00:00')
    for (let second = 1; second <= 498; second++) {
      recorded(machine, second % 2 === 1 ? 0 : 1, afterEnd(second))
    }
    recorded(machine, 0, afterEnd(499))
    recorded(machine, 1, afterEnd(619))
    const stoppedLater = recorded(machine, 0, afterEnd(700))
    // Performance processed the samples up to 10:40:19 while the planned stop covered them
    await RunModeProcessingState.create({
      workCenterId: new Types.ObjectId(machine.workCenterId),
      runModeTagId: new Types.ObjectId(machine.runModeTagId),
      lastProcessedOccurredAt: at(afterEnd(619)),
      lastProcessedValue: 1,
    })

    await closeAt(planned, '10:30:00')
    await tick('10:45:00')

    // The page ends with the stop from 10:38:19, which the machine ended at 10:40:19
    expect(await stopsOf(machine)).toEqual([runModeStop(afterEnd(499), afterEnd(619))])
    expect(await storedCandidate(machine)).toBeNull()

    // The stop at 10:41:40 comes after the cursor, and its own rules decide it
    await deliver(machine, stoppedLater)

    expect(await storedCandidate(machine)).toEqual(candidateSince(afterEnd(700)))
  })
})

// ── Rules 1-3: a stopped signal inside a planned stop that has since closed ──

// The sample is judged as it would have been when it happened: the planned stop covered it then. Once
// the planned stop has closed, the check at its end decides from the history whether the machine still
// stood there
describe('A stopped signal inside a planned stop that has since closed leaves the check at its end (rules 1-3)', () => {
  it('leaves the check when the stopped signal is processed after the planned stop closed', async () => {
    const machine = await machineWithDebounce(0)
    await deliver(machine, recorded(machine, 1, '09:00:00'))
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await closePlannedStop(planned._id, '10:30:00')

    // The machine stopped at 10:05; the signal reaches performance only now, from a backlog
    await deliver(machine, recorded(machine, 0, '10:05:00'))

    // No stop opens inside the planned stop
    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:31:00')

    // The machine still stood when the planned stop ended
    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('leaves the check when the running signal finds the candidate covered by a planned stop that has since closed', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:05:00'))
    // An operator enters the planned stop after the machine's stop was processed
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await closePlannedStop(planned._id, '10:30:00')

    await deliver(machine, recorded(machine, 1, '10:40:00'))

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toBeNull()
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:41:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:40:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('leaves the check when the tick finds the candidate covered by a planned stop that has since closed', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:05:00'))
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await closePlannedStop(planned._id, '10:30:00')

    await tick('10:31:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toBeNull()
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:31:01')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])
    expect(await storedCheck(machine)).toBeNull()
  })

  // Performance lags telemetry: the close reads the machine stopped at 10:20 and opens the stop at E.
  // The running signal from 10:10 then deletes that stop, which started after it (rule 2)
  it('brings the stop at E back when the machine stopped again before E', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    const planned = await activePlannedStop(machine, '10:00:00', '11:00:00')
    await deliver(machine, recorded(machine, 0, '10:02:00'))
    const running = recorded(machine, 1, '10:10:00')
    const stoppedAgain = recorded(machine, 0, '10:20:00')
    await closeAt(planned, '10:30:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])

    await deliver(machine, running)

    expect(await stopsOf(machine)).toEqual([])

    await deliver(machine, stoppedAgain)

    expect(await storedCandidate(machine)).toBeNull()
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:31:00')

    expect(await stopsOf(machine)).toEqual([openRunModeStop('10:30:00')])
  })

  // D = 60 s. The machine stops at 10:00; an operator then enters a planned stop over it that ran
  // until E = 10:00:30
  async function shortCandidateInsideClosedPlannedStop() {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 0, '10:00:00'))
    await closedPlannedStop(machine, ['09:59:00', '10:30:00'], ['09:59:00', '10:00:30'])
    return machine
  }

  it('leaves the check when a running signal shorter than the debounce finds the candidate covered by a planned stop that has since closed', async () => {
    const machine = await shortCandidateInsideClosedPlannedStop()

    await deliver(machine, recorded(machine, 1, '10:00:50'))

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCandidate(machine)).toBeNull()
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:00:30'))

    await tick('10:01:00')

    // The time inside the planned stop is planned, and no debounce applies after its end
    expect(await stopsOf(machine)).toEqual([runModeStop('10:00:30', '10:00:50')])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('records nothing for such a candidate when the machine ran before the planned stop ended', async () => {
    const machine = await shortCandidateInsideClosedPlannedStop()

    await deliver(machine, recorded(machine, 1, '10:00:20'))

    expect(await storedCandidate(machine)).toBeNull()
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:00:30'))

    await tick('10:01:00')

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('leaves the check at the end of a closed planned stop that a planned one overlaps, and records nothing while that one covers E', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 1, '09:00:00'))
    // Two planned windows overlap: one planned stop ran until 10:30, the other was never started
    await closedPlannedStop(machine, ['10:00:00', '10:40:00'], ['10:00:00', '10:30:00'])
    await plannedStopNotStarted(machine, '10:20:00', '10:50:00')

    // The machine's stop at 10:25 reaches performance only now
    await deliver(machine, recorded(machine, 0, '10:25:00'))

    expect(await storedCandidate(machine)).toBeNull()
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:31:00')

    // The planned stop that was never started covers E
    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toBeNull()
  })
})

// ── Rule 4: one check holds the earliest pending end ─────────────────────────

describe('One check holds the earliest pending end and hands over to the next planned stop (rule 4)', () => {
  it('decides the end of each planned stop that closed while telemetry was down', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    stubs.latest.mode = 'fail'
    stubs.stateDurations.mode = 'fail'
    // The machine stands from 10:05 to 10:35, through the end of the first planned stop, and from
    // 10:45 to 10:55, through the end of the second; telemetry stores it all once it is back
    for (const [value, time] of [
      [1, '09:00:00'],
      [0, '10:05:00'],
      [1, '10:35:00'],
      [0, '10:45:00'],
      [1, '10:55:00'],
    ] as const) {
      recorded(machine, value, time)
    }
    const first = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await closeAt(first, '10:30:00')
    const second = await activePlannedStop(machine, '10:40:00', '10:50:00')
    await closeAt(second, '10:50:00')

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    stubs.stateDurations.mode = 'answer'
    await tick('10:56:00')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:30:00', '10:35:00')])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:50:00'))

    await tick('10:56:01')

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:30:00', '10:35:00'),
      runModeStop('10:50:00', '10:55:00'),
    ])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('ends the stop at the start of the next planned stop when the machine stood through it', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    stubs.latest.mode = 'fail'
    // The machine stands from 10:05 until 11:00, through both planned stops
    recorded(machine, 1, '09:00:00')
    recorded(machine, 0, '10:05:00')
    recorded(machine, 1, '11:00:00')
    const first = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await closeAt(first, '10:30:00')
    const second = await activePlannedStop(machine, '10:40:00', '10:50:00')
    await closeAt(second, '10:50:00')

    await tick('11:01:00')
    await tick('11:01:01')

    // The second planned stop's start would have closed the first stop, had it been open then
    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:30:00', '10:40:00'),
      runModeStop('10:50:00', '11:00:00'),
    ])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('replaces a pending check with the earlier end a late stopped signal leaves', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    await deliver(machine, recorded(machine, 1, '09:00:00'))
    // Telemetry answers, but the machine's stop at 10:05 still waits at the broker: the close reads
    // the machine running and leaves nothing
    const first = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await closeAt(first, '10:30:00')

    expect(await storedCheck(machine)).toBeNull()

    // Telemetry goes down before the second planned stop closes
    stubs.latest.mode = 'fail'
    const second = await activePlannedStop(machine, '10:40:00', '10:50:00')
    await closeAt(second, '10:50:00')

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:50:00'))

    // Telemetry is back and works off the backlog
    stubs.latest.mode = 'answer'
    const backlog = [
      recorded(machine, 0, '10:05:00'),
      recorded(machine, 1, '10:35:00'),
      recorded(machine, 0, '10:45:00'),
      recorded(machine, 1, '10:55:00'),
    ]
    await deliver(machine, backlog[0])

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    for (const event of backlog.slice(1)) await deliver(machine, event)
    await tick('10:56:00')
    await tick('10:56:01')

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:30:00', '10:35:00'),
      runModeStop('10:50:00', '10:55:00'),
    ])
    expect(await storedCheck(machine)).toBeNull()
  })

  it('gives the check it hands over 25 hours of its own', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    stubs.latest.mode = 'fail'
    recorded(machine, 1, '09:00:00')
    const first = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await closeAt(first, '10:30:00')
    const second = await activePlannedStop(machine, '10:40:00', '10:50:00')
    await closeAt(second, '10:50:00')
    // As if the first check had waited 23 hours: 2 of its 25 hours are left
    await testRedis.expire(checkKey(machine), 7_200)

    await runDecisionTick(new Date(at('10:30:00').getTime() + 23 * 3_600_000))

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:50:00'))
    expect(await testRedis.ttl(checkKey(machine))).toBeGreaterThan(89_900)
  })
})

// ── Rule 4: another planned stop that covers the end ─────────────────────────

describe('The check records nothing at an end that another planned stop covers (rule 4)', () => {
  it('records nothing at E inside the next planned stop, and decides the end of that one in turn', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 1, '09:00:00'))
    // The first planned stop, planned until 10:20, ran until 10:30, into the window of the second,
    // planned from 10:25 and started late, at 10:40
    await closedPlannedStop(machine, ['10:00:00', '10:20:00'], ['10:00:00', '10:30:00'])
    await closedPlannedStop(machine, ['10:25:00', '10:50:00'], ['10:40:00', '10:50:00'])

    // The machine's stop at 10:05 reaches performance only now, as does its run at 10:55
    await deliver(machine, recorded(machine, 0, '10:05:00'))
    await deliver(machine, recorded(machine, 1, '10:55:00'))

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    await tick('10:56:00')

    // From 10:30 the machine stood in the second planned stop's window, as the close at 10:30
    // would have found it
    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:50:00'))

    await tick('10:56:01')

    expect(await stopsOf(machine)).toEqual([runModeStop('10:50:00', '10:55:00')])
    expect(await storedCheck(machine)).toBeNull()
  })
})

// ── Rule 4: a check dropped after 24 hours ───────────────────────────────────

describe('A check dropped after 24 hours hands the key on (rule 4)', () => {
  let logs: ReturnType<typeof watchDecisionLogs>

  beforeEach(() => {
    logs = watchDecisionLogs()
  })

  afterEach(() => {
    logs.restore()
  })

  it('stores the check of the next planned stop when the pending one is dropped, and the next tick decides it', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    stubs.latest.mode = 'fail'
    // The machine stood from 11:50 to 12:05
    recorded(machine, 1, '09:00:00')
    recorded(machine, 0, '11:50:00')
    recorded(machine, 1, '12:05:00')
    const first = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await closeAt(first, '10:30:00')
    const second = await activePlannedStop(machine, '11:30:00', '12:00:00')
    await closeAt(second, '12:00:00')

    // The earlier end is kept; the later close could not leave its own check
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    // A day later the check since 10:30 is past its 24 hours, the one since 12:00 is not
    const dayLater = at('10:30:00').getTime() + 24 * 3_600_000
    await runDecisionTick(new Date(dayLater + 1000))

    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('12:00:00'))

    await runDecisionTick(new Date(dayLater + 2000))

    expect(await stopsOf(machine)).toEqual([runModeStop('12:00:00', '12:05:00')])
    expect(await storedCheck(machine)).toBeNull()
    expect(logs.lines()).toEqual([
      ['warn', expect.objectContaining({ event: 'internal_api.telemetry.fetch_failed' })],
      ['warn', expect.objectContaining({ event: 'internal_api.telemetry.fetch_failed' })],
      [
        'error',
        {
          event: 'run_mode.decision.abandoned',
          kind: 'after_planned',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:30:00').toISOString(),
          attempts: 0,
        },
      ],
    ])
  })

  // MongoDB answers every read of planned stops with an error until fn is done: they are served by a
  // view whose pipeline fails
  async function whileMongoRefusesPlannedStopReads<T>(fn: () => Promise<T>): Promise<T> {
    const db = mongoose.connection.db
    if (!db) throw new Error('MongoDB is not connected')
    const name = PlannedStop.collection.collectionName
    await db.renameCollection(name, `${name}_held`)
    await db.createCollection(name, {
      viewOn: `${name}_held`,
      pipeline: [{ $addFields: { refused: { $toInt: 'not a number' } } }],
    })
    try {
      return await fn()
    } finally {
      await db.dropCollection(name)
      await db.renameCollection(`${name}_held`, name)
    }
  }

  it('waits for its next attempt when the next planned stop cannot be read, and then hands the key on', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    stubs.latest.mode = 'fail'
    recorded(machine, 1, '09:00:00')
    const first = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await closeAt(first, '10:30:00')
    const second = await activePlannedStop(machine, '11:30:00', '12:00:00')
    await closeAt(second, '12:00:00')
    const dayLater = at('10:30:00').getTime() + 24 * 3_600_000

    await whileMongoRefusesPlannedStopReads(async () => {
      await runDecisionTick(new Date(dayLater + 1000))
      // Its next attempt has not come: the drop is not tried, and nothing is logged
      await runDecisionTick(new Date(dayLater + 1500))
    })

    expect(await storedCheck(machine)).toEqual({
      ...afterPlannedSince('10:30:00'),
      attempts: 1,
      nextAttemptAt: new Date(dayLater + 2000).toISOString(),
    })

    await runDecisionTick(new Date(dayLater + 2000))

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('12:00:00'))
    expect(logs.lines()).toEqual([
      ['warn', expect.objectContaining({ event: 'internal_api.telemetry.fetch_failed' })],
      ['warn', expect.objectContaining({ event: 'internal_api.telemetry.fetch_failed' })],
      [
        'warn',
        {
          event: 'run_mode.decision.deferred',
          kind: 'after_planned',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:30:00').toISOString(),
          nextAttemptAt: new Date(dayLater + 2000).toISOString(),
          error: expect.stringContaining('not a number'),
        },
      ],
      [
        'error',
        {
          event: 'run_mode.decision.abandoned',
          kind: 'after_planned',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:30:00').toISOString(),
          attempts: 1,
        },
      ],
    ])
  })

  // Runs meanwhile between the moment the drop of an expired check has read which planned stop
  // closed next and the moment it swaps the key: a spy that calls through to that one read
  function afterReadingTheNextPlannedStop(meanwhile: () => Promise<void>) {
    const findOne = PlannedStop.findOne.bind(PlannedStop) as (...args: unknown[]) => {
      exec: () => Promise<unknown>
    }
    let ran = false
    return vi.spyOn(PlannedStop, 'findOne').mockImplementation(((
      filter?: { status?: unknown; actualEndAt?: { $gt?: unknown } },
      ...rest: unknown[]
    ) => {
      const query = findOne(filter, ...rest)
      if (!ran && filter?.status === 'closed' && filter.actualEndAt?.$gt) {
        ran = true
        const exec = query.exec.bind(query)
        query.exec = async () => {
          const answer = await exec()
          await meanwhile()
          return answer
        }
      }
      return query
    }) as never)
  }

  it('loses no check that a planned stop closing meanwhile leaves', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    stubs.latest.mode = 'fail'
    recorded(machine, 1, '09:00:00')
    const first = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await closeAt(first, '10:30:00')
    const second = await activePlannedStop(machine, '11:30:00', '12:00:00')
    // The second planned stop closes while telemetry is down, after the drop has read that no planned
    // stop closed after 10:30 and before it swaps the key. Its check is refused while the earlier one
    // is stored, so it must wait for the drop to finish
    let closing: Promise<unknown> = Promise.resolve()
    const spy = afterReadingTheNextPlannedStop(async () => {
      closing = closeAt(second, '12:00:00')
      await Promise.race([closing, new Promise(resolve => setTimeout(resolve, 1000))])
    })
    try {
      await runDecisionTick(new Date(at('10:30:00').getTime() + 24 * 3_600_000 + 1000))
      await closing
    } finally {
      spy.mockRestore()
    }

    expect(await storedCheck(machine)).toEqual(afterPlannedSince('12:00:00'))
    expect(logs.lines()).toEqual([
      ['warn', expect.objectContaining({ event: 'internal_api.telemetry.fetch_failed' })],
      ['warn', expect.objectContaining({ event: 'internal_api.telemetry.fetch_failed' })],
      [
        'error',
        expect.objectContaining({
          event: 'run_mode.decision.abandoned',
          since: at('10:30:00').toISOString(),
        }),
      ],
    ])
  })
})

// ── Rule 5: the tick decides a check only while it waits on the same end ─────

describe('The tick decides a check only while it waits on the same end (rule 5)', () => {
  it('decides nothing from an answer about a check that an earlier one replaced while it asked', async () => {
    const machine = await machineWithDebounce(60_000)
    monitoredByWorkCenter(machine)
    stubs.latest.mode = 'fail'
    recorded(machine, 1, '09:00:00')
    recorded(machine, 0, '10:10:00')
    const later = await activePlannedStop(machine, '10:35:00', '10:40:00')
    await closeAt(later, '10:40:00')
    stubs.stateDurations.mode = 'hang'
    const pending = tick('10:41:00')
    await vi.waitFor(() => expect(held.size).toBe(1))
    const [question] = held
    const history = stateDurations(question.req)

    // An operator enters a planned stop from 10:00 to 10:30 after the fact, while telemetry is down
    const earlier = await activePlannedStop(machine, '10:00:00', '10:30:00')
    await closeAt(earlier, '10:30:00')
    releaseHeld(res => res.json({ data: history }))
    await pending

    // The answer was about the check at 10:40, which no longer waits; no sample moved the cursor
    expect(await stopsOf(machine)).toEqual([])
    expect(await storedCheck(machine)).toEqual(afterPlannedSince('10:30:00'))

    stubs.stateDurations.mode = 'answer'
    await tick('10:42:00')
    await tick('10:42:01')

    expect(await stopsOf(machine)).toEqual([
      runModeStop('10:30:00', '10:35:00'),
      openRunModeStop('10:40:00'),
    ])
    expect(await storedCheck(machine)).toBeNull()
  })
})
