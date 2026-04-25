import '../../../test/contract-setup.js'

import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapSystemReasons } from '../../reason/reason.bootstrap.js'
import { UnplannedStop } from '../../unplanned-stop/unplanned-stop.model.js'
import { handleRunModeSample } from '../run-mode.processor.js'

// run-mode.processor calls external HTTP (telemetry, work-center) only in
// confirmCandidate (debounce tick path). handleRunModeSample with debounceMs=0
// goes straight to openUnplannedFromRunMode — no HTTP calls needed.
// We stub the two HTTP clients used in the zero-debounce path.

vi.mock('../../../lib/internal-api/work-center.client.js', () => ({
  getById: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('../../../lib/internal-api/telemetry.client.js', () => ({
  getLatest: vi.fn(),
  getStateDurations: vi.fn(),
  producedSummary: vi.fn(),
  speedSummary: vi.fn(),
}))

// policy.service uses Mongo directly — no mock needed with real DB.
// We also need to stub the events emitter so it doesn't fail (no streamClient).
vi.mock('../../../jobs/events.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  emitUnplannedStopOpened: vi.fn().mockResolvedValue(undefined),
  emitUnplannedStopClosed: vi.fn().mockResolvedValue(undefined),
  emitUnplannedStopConverted: vi.fn().mockResolvedValue(undefined),
  emitUnplannedStopUpdated: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopCreated: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopUpdated: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopStarted: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopClosed: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopCancelled: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopDeleted: vi.fn().mockResolvedValue(undefined),
  emitReasonCreated: vi.fn().mockResolvedValue(undefined),
  emitReasonUpdated: vi.fn().mockResolvedValue(undefined),
  emitReasonDeleted: vi.fn().mockResolvedValue(undefined),
  emitPolicyUpdated: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopTemplateCreated: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopTemplateUpdated: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopTemplateDeleted: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopTemplateStarted: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopScheduleCreated: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopScheduleUpdated: vi.fn().mockResolvedValue(undefined),
  emitPlannedStopScheduleDeleted: vi.fn().mockResolvedValue(undefined),
}))

// Use stable hex IDs so the unique index on (workCenterId, endAt=null) doesn't
// conflict across tests (afterEach clears all collections, so this is fine).
const WC_ID = new Types.ObjectId().toHexString()
const TAG_ID = new Types.ObjectId().toHexString()

beforeEach(async () => {
  // afterEach (from contract-setup) wipes all collections — re-bootstrap each time.
  await bootstrapSystemReasons()
})

describe('run-mode processor — zero-debounce path (real Mongo)', () => {
  it('value < 1 with debounceMs=0 → creates an open UnplannedStop in DB', async () => {
    const occurredAt = new Date('2026-01-01T08:00:00.000Z')

    await handleRunModeSample({
      workCenterId: WC_ID,
      runModeTagId: TAG_ID,
      value: 0,
      occurredAt,
    })

    const stop = await UnplannedStop.findOne({
      workCenterId: new Types.ObjectId(WC_ID),
      endAt: null,
    }).lean()

    expect(stop).not.toBeNull()
    expect(stop!.source).toBe('run_mode')
    expect(stop!.startAt.toISOString()).toBe(occurredAt.toISOString())
    expect(stop!.endAt).toBeNull()
  })

  it('value >= 1 after an open stop → closes the UnplannedStop', async () => {
    const startedAt = new Date('2026-01-01T08:00:00.000Z')
    const resumedAt = new Date('2026-01-01T08:05:00.000Z')

    // First sample: opens the stop
    await handleRunModeSample({
      workCenterId: WC_ID,
      runModeTagId: TAG_ID,
      value: 0,
      occurredAt: startedAt,
    })

    const openStop = await UnplannedStop.findOne({
      workCenterId: new Types.ObjectId(WC_ID),
      endAt: null,
    }).lean()
    expect(openStop).not.toBeNull()

    // Second sample: running again → should close
    await handleRunModeSample({
      workCenterId: WC_ID,
      runModeTagId: TAG_ID,
      value: 1,
      occurredAt: resumedAt,
    })

    const closedStop = await UnplannedStop.findById(openStop!._id).lean()
    expect(closedStop).not.toBeNull()
    expect(closedStop!.endAt).not.toBeNull()
    expect(closedStop!.endAt!.toISOString()).toBe(resumedAt.toISOString())
  })

  it('duplicate sample (same timestamp) is skipped — cursor prevents second stop', async () => {
    const occurredAt = new Date('2026-01-01T09:00:00.000Z')

    // First: stopped sample creates a stop
    await handleRunModeSample({
      workCenterId: WC_ID,
      runModeTagId: TAG_ID,
      value: 0,
      occurredAt,
    })

    const firstCount = await UnplannedStop.countDocuments({
      workCenterId: new Types.ObjectId(WC_ID),
    })
    expect(firstCount).toBe(1)

    // Replay the same stopped sample — cursor has this timestamp already, should be no-op
    await handleRunModeSample({
      workCenterId: WC_ID,
      runModeTagId: TAG_ID,
      value: 0,
      occurredAt, // same timestamp → cursor rejects it
    })

    // Still exactly 1 stop — no duplicate
    const secondCount = await UnplannedStop.countDocuments({
      workCenterId: new Types.ObjectId(WC_ID),
    })
    expect(secondCount).toBe(1)
  })

  it('planned stop covering the instant suppresses unplanned stop creation', async () => {
    const { PlannedStop } = await import('../../planned-stop/planned-stop.model.js')
    const { Reason } = await import('../../reason/reason.model.js')
    const { SYSTEM_IDENTITY } = await import('../../../constants/identity.js')

    const systemActor = new Types.ObjectId(SYSTEM_IDENTITY)
    const reason = await Reason.create({
      code: 'PLANNED_REASON_RM',
      name: 'Planned Reason for RunMode Test',
      usages: ['planned_stop'],
      affectsOee: false,
      isSystemDefault: false,
      isActive: true,
      canStartManually: true,
      canBeScheduled: false,
      canConvertFromUnplanned: false,
      requiresDescription: false,
      createdBy: systemActor,
    })

    const stoppedAt = new Date('2026-01-01T10:00:00.000Z')
    const plannedEnd = new Date('2026-01-01T10:30:00.000Z')

    await PlannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: reason._id,
      plannedOwnerId: systemActor,
      source: 'manual',
      startMode: 'automatic',
      status: 'planned',
      plannedStartAt: new Date('2026-01-01T09:55:00.000Z'),
      plannedEndAt: plannedEnd,
      createdBy: null,
    })

    await handleRunModeSample({
      workCenterId: WC_ID,
      runModeTagId: TAG_ID,
      value: 0,
      occurredAt: stoppedAt,
    })

    const stop = await UnplannedStop.findOne({
      workCenterId: new Types.ObjectId(WC_ID),
      endAt: null,
    }).lean()

    expect(stop).toBeNull()
  })
})
