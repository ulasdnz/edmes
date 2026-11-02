import { Types } from 'mongoose'
import { getLatest, getStateDurations } from '../../lib/internal-api/run-mode-telemetry.client.js'
import { getById as getWorkCenter } from '../../lib/internal-api/work-center.client.js'
import { logger } from '../../lib/logger.js'
import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import { resolveForWorkCenter } from '../policy/policy.service.js'
import {
  closeOnRunning,
  openFromRunMode as openUnplannedFromRunMode,
  recordClosedFromRunMode,
} from '../unplanned-stop/unplanned-stop.service.js'
import { deleteDecision, readDecision, writeDecisionIfAbsent } from './run-mode.decisions.js'
import { RunModeProcessingState } from './run-mode-processing-state.model.js'

export interface RunModeSample {
  workCenterId: string
  runModeTagId: string
  value: number
  occurredAt: Date
  // The tag's sample telemetry stored before this one, null for its first, as tag.value.recorded
  // carries it; a sample replayed from telemetry's history has none
  previousOccurredAt?: Date | null
}

async function plannedStopCovers(workCenterId: string, at: Date): Promise<boolean> {
  const hit = await PlannedStop.exists({
    workCenterId: new Types.ObjectId(workCenterId),
    status: { $in: ['planned', 'active'] },
    plannedStartAt: { $lte: at },
    plannedEndAt: { $gt: at },
  })
  return Boolean(hit)
}

async function updateCursor(sample: RunModeSample): Promise<void> {
  await RunModeProcessingState.findOneAndUpdate(
    {
      workCenterId: new Types.ObjectId(sample.workCenterId),
      runModeTagId: new Types.ObjectId(sample.runModeTagId),
    },
    {
      $set: {
        lastProcessedOccurredAt: sample.occurredAt,
        lastProcessedValue: sample.value,
      },
    },
    { upsert: true },
  )
}

async function readCursor(
  workCenterId: string,
  runModeTagId: string,
): Promise<{ lastProcessedOccurredAt: Date; lastProcessedValue: number } | null> {
  const doc = await RunModeProcessingState.findOne({
    workCenterId: new Types.ObjectId(workCenterId),
    runModeTagId: new Types.ObjectId(runModeTagId),
  })
    .select({ lastProcessedOccurredAt: 1, lastProcessedValue: 1 })
    .lean()
  if (!doc) return null
  return {
    lastProcessedOccurredAt: doc.lastProcessedOccurredAt,
    lastProcessedValue: doc.lastProcessedValue,
  }
}

export async function handleRunModeSample(sample: RunModeSample): Promise<void> {
  const cursor = await readCursor(sample.workCenterId, sample.runModeTagId)
  if (cursor && sample.occurredAt.getTime() <= cursor.lastProcessedOccurredAt.getTime()) {
    return
  }

  // Telemetry stored samples after the cursor that were never processed here; they come first
  if (
    cursor &&
    sample.previousOccurredAt &&
    sample.previousOccurredAt.getTime() > cursor.lastProcessedOccurredAt.getTime()
  ) {
    await replayGap(sample, cursor.lastProcessedOccurredAt)
  }

  if (sample.value < 1) {
    await handleStopped(sample)
  } else {
    await handleRunning(sample)
  }

  await updateCursor(sample)
}

// A sample that failed and was overtaken before its redelivery, a dead letter, a failed publish or
// a gap in the tag map leaves samples only telemetry's history still holds
async function replayGap(sample: RunModeSample, from: Date): Promise<void> {
  const { replayed, complete } = await replayStoredSamples(sample, from, sample.occurredAt)
  logger.warn('Run-mode samples missed by performance were replayed from telemetry', {
    event: 'run_mode.sample.gap_replayed',
    workCenterId: sample.workCenterId,
    runModeTagId: sample.runModeTagId,
    from: from.toISOString(),
    to: sample.occurredAt.toISOString(),
    replayed,
  })
  // Deciding the sample now would skip the samples not replayed yet; its redelivery goes on
  if (!complete) throw new Error('Run-mode replay reached its page limit before the sample')
}

export const MAX_REPLAY_PAGES = 100

export interface ReplayResult {
  replayed: number
  // False when the page limit ended the replay before `to`
  complete: boolean
}

// Replays the tag's samples telemetry stored after `from` and before `to`, in their order, through
// the same rules as a delivered sample; each one advances the cursor. Every state-durations segment
// starts at a stored sample, except the first, which starts at `from`. Pages bound the payload after
// a long outage; the next page starts with the sample whose segment the page before left open.
export async function replayStoredSamples(
  target: MonitoredWorkCenter,
  from: Date,
  to: Date,
): Promise<ReplayResult> {
  let replayed = 0
  let after: Date | undefined
  for (let page = 0; page < MAX_REPLAY_PAGES; page++) {
    const { segments, hasMore, nextCursor } = await getStateDurations(
      target.runModeTagId,
      from,
      to,
      { after },
    )
    for (const segment of segments) {
      const occurredAt = new Date(segment.start)
      if (occurredAt.getTime() <= from.getTime()) continue
      await handleRunModeSample({
        workCenterId: target.workCenterId,
        runModeTagId: target.runModeTagId,
        value: segment.state,
        occurredAt,
      })
      replayed++
    }
    if (!hasMore || !nextCursor) return { replayed, complete: true }
    after = new Date(nextCursor)
  }
  return { replayed, complete: false }
}

async function handleStopped(sample: RunModeSample): Promise<void> {
  if (await plannedStopCovers(sample.workCenterId, sample.occurredAt)) return

  const policy = await resolveForWorkCenter(sample.workCenterId)
  if (policy.runModeDebounceMs === 0) {
    await openUnplannedFromRunMode(sample.workCenterId, sample.occurredAt)
    return
  }

  // A redelivered sample leaves the candidate as it was first written
  await writeDecisionIfAbsent(sample.workCenterId, sample.runModeTagId, {
    kind: 'debounce',
    since: sample.occurredAt.toISOString(),
    debounceMs: policy.runModeDebounceMs,
    attempts: 0,
    nextAttemptAt: null,
  })
}

async function handleRunning(sample: RunModeSample): Promise<void> {
  const candidate = await readDecision('debounce', sample.workCenterId, sample.runModeTagId)
  if (candidate) {
    const firstStoppedAt = new Date(candidate.since)
    const stoppedMs = sample.occurredAt.getTime() - firstStoppedAt.getTime()
    if (
      stoppedMs >= candidate.debounceMs &&
      !(await plannedStopCovers(sample.workCenterId, firstStoppedAt))
    ) {
      await recordClosedFromRunMode(sample.workCenterId, firstStoppedAt, sample.occurredAt)
    }
    await deleteDecision('debounce', sample.workCenterId, sample.runModeTagId)
  }

  // Closes the stop the tick may have opened at T0, or deletes it if the signal shows it too short
  const debounceMs =
    candidate?.debounceMs ?? (await resolveForWorkCenter(sample.workCenterId)).runModeDebounceMs
  await closeOnRunning(sample.workCenterId, sample.occurredAt, debounceMs)
}

export interface ConfirmationTarget {
  workCenterId: string
  runModeTagId: string
}

export async function confirmCandidate(target: ConfirmationTarget): Promise<void> {
  const candidate = await readDecision('debounce', target.workCenterId, target.runModeTagId)
  if (!candidate) return

  const firstStoppedAt = new Date(candidate.since)
  const maturedAt = firstStoppedAt.getTime() + candidate.debounceMs
  if (Date.now() < maturedAt) return

  const latest = await getLatest(target.runModeTagId)
  if (!latest || latest.value >= 1) {
    await deleteDecision('debounce', target.workCenterId, target.runModeTagId)
    return
  }

  if (await plannedStopCovers(target.workCenterId, firstStoppedAt)) {
    await deleteDecision('debounce', target.workCenterId, target.runModeTagId)
    return
  }

  await openUnplannedFromRunMode(target.workCenterId, firstStoppedAt)
  await deleteDecision('debounce', target.workCenterId, target.runModeTagId)
}

export interface MonitoredWorkCenter {
  workCenterId: string
  runModeTagId: string
}

export async function listMonitoredFromCursors(): Promise<MonitoredWorkCenter[]> {
  const cursors = await RunModeProcessingState.find()
    .select({ workCenterId: 1, runModeTagId: 1 })
    .lean()
  return cursors.map(c => ({
    workCenterId: c.workCenterId.toString(),
    runModeTagId: c.runModeTagId.toString(),
  }))
}

export async function resolveRunModeTagId(workCenterId: string): Promise<string | null> {
  const wc = await getWorkCenter(workCenterId)
  return wc?.tagBindings?.runModeTagId ?? null
}

export function logSkippedSample(sample: RunModeSample, reason: string): void {
  logger.debug('Run-mode sample skipped', {
    event: 'run_mode.sample.skipped',
    workCenterId: sample.workCenterId,
    runModeTagId: sample.runModeTagId,
    occurredAt: sample.occurredAt.toISOString(),
    reason,
  })
}
