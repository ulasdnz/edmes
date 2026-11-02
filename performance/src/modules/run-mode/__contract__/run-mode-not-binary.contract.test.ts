import '../../../test/contract-setup.js'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { leaveAfterPlannedCheck } from '../run-mode.processor.js'
import { reconcileWorkCenter } from '../run-mode.reconciler.js'
import {
  afterPlannedSince,
  at,
  candidateSince,
  cursorOf,
  deliver,
  type Machine,
  machineWithDebounce,
  received,
  recorded,
  stopsOf,
  storedCandidate,
  storedCheck,
  stubs,
  tick,
  watchDecisionLogs,
} from './run-mode-outage.harness.js'

// Work-center binds any tag as a work center's run-mode tag, but only a binary one says whether the
// machine runs. Telemetry publishes each sample with its tag's behavior, and answers 400
// historian.binary_only when asked for the states of a tag that is not binary

let logs: ReturnType<typeof watchDecisionLogs>

beforeEach(() => {
  logs = watchDecisionLogs()
})

afterEach(() => {
  logs.restore()
})

// The value telemetry recorded for a run-mode tag that is a speed tag
const asSpeed = <T extends { behavior: string }>(event: T): T => ({ ...event, behavior: 'speed' })

const notBinaryWarning = (machine: Machine) => [
  'warn',
  {
    event: 'run_mode.sample.not_binary',
    workCenterId: machine.workCenterId,
    runModeTagId: machine.runModeTagId,
    behavior: 'speed',
  },
]

describe('Samples of a run-mode tag that is not binary', () => {
  it('skips them for the run-mode rules, with one warning for the tag', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 1, '10:00:00'))

    await deliver(machine, asSpeed(recorded(machine, 0, '10:05:00')))
    await deliver(machine, asSpeed(recorded(machine, 12.5, '10:06:00')))
    await deliver(machine, asSpeed(recorded(machine, 0, '10:07:00')))

    // Neither the candidate a stopped value would leave, nor a cursor past the binary sample
    expect(await storedCandidate(machine)).toBeNull()
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))
    expect(logs.lines()).toEqual([notBinaryWarning(machine)])
  })

  it('warns again once the tag has sent binary samples in between', async () => {
    const machine = await machineWithDebounce(60_000)

    await deliver(machine, asSpeed(recorded(machine, 0, '10:00:00')))
    await deliver(machine, recorded(machine, 1, '10:05:00'))
    await deliver(machine, asSpeed(recorded(machine, 0, '10:10:00')))

    // The binary sample was decided
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:05:00'))
    expect(await storedCandidate(machine)).toBeNull()
    expect(logs.lines()).toEqual([notBinaryWarning(machine), notBinaryWarning(machine)])
  })

  it('decides a sample that names no behavior', async () => {
    const machine = await machineWithDebounce(60_000)
    const { behavior: _, ...withoutBehavior } = recorded(machine, 0, '10:00:00')

    await deliver(machine, withoutBehavior as Parameters<typeof deliver>[1])

    expect(await storedCandidate(machine)).toEqual(candidateSince('10:00:00'))
    expect(logs.lines()).toEqual([])
  })
})

describe('Telemetry says the run-mode tag is not binary', () => {
  it('drops a pending check instead of retrying it', async () => {
    const machine = await machineWithDebounce(60_000)
    await leaveAfterPlannedCheck(machine, at('10:00:00'))
    stubs.stateDurations.mode = 'not_binary'

    await tick('10:01:00')
    await tick('10:02:00')

    expect(await storedCheck(machine)).toBeNull()
    expect(received.stateDurations).toHaveLength(1)
    expect(await stopsOf(machine)).toEqual([])
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'run_mode.decision.not_binary',
          kind: 'after_planned',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
        },
      ],
    ])
  })

  it('still defers a check when telemetry rejects the request for another reason', async () => {
    const machine = await machineWithDebounce(60_000)
    await leaveAfterPlannedCheck(machine, at('10:00:00'))
    stubs.stateDurations.mode = 'bad_request'

    await tick('10:01:00')

    expect(await storedCheck(machine)).toEqual({
      ...afterPlannedSince('10:00:00'),
      attempts: 1,
      nextAttemptAt: at('10:01:01').toISOString(),
    })
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'run_mode.decision.deferred',
          kind: 'after_planned',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          since: at('10:00:00').toISOString(),
          nextAttemptAt: at('10:01:01').toISOString(),
          error: 'error.telemetry_unreachable',
          cause: 'HTTP 400',
        },
      ],
    ])
  })

  it('ends the replay of a gap and decides the signal, so it is neither retried nor dead-lettered', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 1, '10:00:00'))
    // Stored by telemetry, never received by performance
    recorded(machine, 0, '10:05:00')
    stubs.stateDurations.mode = 'not_binary'

    await expect(deliver(machine, recorded(machine, 1, '10:10:00'))).resolves.toBeUndefined()

    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:10:00'))
    expect(await stopsOf(machine)).toEqual([])
    expect(received.stateDurations).toHaveLength(1)
    // As for a tag telemetry does not know: nothing was replayed
    expect(logs.lines()).toEqual([
      [
        'warn',
        {
          event: 'run_mode.sample.gap_replayed',
          workCenterId: machine.workCenterId,
          runModeTagId: machine.runModeTagId,
          from: at('10:00:00').toISOString(),
          to: at('10:10:00').toISOString(),
          replayed: 0,
        },
      ],
    ])
  })

  it('ends a reconciliation instead of failing it, so it is not retried', async () => {
    const machine = await machineWithDebounce(60_000)
    await deliver(machine, recorded(machine, 1, '10:00:00'))
    recorded(machine, 0, '10:05:00')
    stubs.stateDurations.mode = 'not_binary'

    await expect(reconcileWorkCenter(machine, at('10:10:00'))).resolves.toBeUndefined()

    expect(received.stateDurations).toHaveLength(1)
    expect((await cursorOf(machine))?.lastProcessedOccurredAt).toEqual(at('10:00:00'))
    expect(logs.lines()).toEqual([])
  })
})
