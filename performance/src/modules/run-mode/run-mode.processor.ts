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
import {
  afterPlannedCheck,
  deferDecision,
  deleteDecision,
  dropDecisionOfUnknownTag,
  logDecisionResolved,
  type PendingDecision,
  readDecision,
  readDueDecision,
  resolveDecision,
  writeCheckIfEarlier,
  writeDecisionIfAbsent,
} from './run-mode.decisions.js'
import { withTagLock } from './run-mode.lock.js'
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

// A planned stop covered T when its planned window holds T and it had not closed by T: the answer
// a sample at T got when it happened, however late it is processed. endedAt is null while that
// planned stop is still planned or active, and its end once it has closed (the earliest, should
// several have covered T): the check at that end then decides from the history whether the machine
// still stood there
async function plannedStopCovering(
  workCenterId: string,
  at: Date,
): Promise<{ endedAt: Date | null } | null> {
  const covering = await PlannedStop.find({
    workCenterId: new Types.ObjectId(workCenterId),
    plannedStartAt: { $lte: at },
    plannedEndAt: { $gt: at },
    $or: [
      { status: { $in: ['planned', 'active'] } },
      { status: 'closed', actualEndAt: { $gt: at } },
    ],
  })
    .select({ status: 1, actualEndAt: 1 })
    .sort({ actualEndAt: 1 })
    .lean()
  if (covering.length === 0) return null
  if (covering.some(stop => stop.status !== 'closed')) return { endedAt: null }
  return { endedAt: covering[0].actualEndAt ?? null }
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

interface Cursor {
  lastProcessedOccurredAt: Date
  lastProcessedValue: number
}

async function readCursor(workCenterId: string, runModeTagId: string): Promise<Cursor | null> {
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

// The cursor guard: a sample at or before the last one processed was decided already
const isProcessed = (sample: RunModeSample, cursor: Cursor | null): boolean =>
  cursor !== null && sample.occurredAt.getTime() <= cursor.lastProcessedOccurredAt.getTime()

export async function handleRunModeSample(sample: RunModeSample): Promise<void> {
  const cursor = await readCursor(sample.workCenterId, sample.runModeTagId)
  if (isProcessed(sample, cursor)) return

  // Telemetry stored samples after the cursor that were never processed here; they come first.
  // The replay asks telemetry outside the tag's lock, and each sample it replays takes the lock
  // for its own decision
  if (
    cursor &&
    sample.previousOccurredAt &&
    sample.previousOccurredAt.getTime() > cursor.lastProcessedOccurredAt.getTime()
  ) {
    await replayGap(sample, cursor.lastProcessedOccurredAt)
  }

  await withTagLock(sample, async () => {
    // Another path may have processed this sample, or a later one, while this one waited: the
    // cursor only moves forward
    if (isProcessed(sample, await readCursor(sample.workCenterId, sample.runModeTagId))) return
    if (sample.value < 1) {
      await handleStopped(sample)
    } else {
      await handleRunning(sample)
    }
    await updateCursor(sample)
  })
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
    const stored = await getStateDurations(target.runModeTagId, from, to, { after })
    // Telemetry does not know the tag, so it stored nothing to replay
    if (!stored) return { replayed, complete: true }
    const { segments, hasMore, nextCursor } = stored
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

// Rules 1 and 2 run under the tag's lock, so the check they leave is written without taking it
async function handleStopped(sample: RunModeSample): Promise<void> {
  const covering = await plannedStopCovering(sample.workCenterId, sample.occurredAt)
  if (covering) {
    if (covering.endedAt) await writeCheckIfEarlier(sample, covering.endedAt)
    return
  }

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
    const covering = await plannedStopCovering(sample.workCenterId, firstStoppedAt)
    if (covering?.endedAt) {
      // However short the stop: the time inside the planned stop is planned, and no debounce
      // applies after its end
      await writeCheckIfEarlier(sample, covering.endedAt)
    } else if (!covering && stoppedMs >= candidate.debounceMs) {
      await recordClosedFromRunMode(sample.workCenterId, firstStoppedAt, sample.occurredAt)
    }
    if (await deleteDecision('debounce', sample.workCenterId, sample.runModeTagId)) {
      logDecisionResolved(sample, candidate, new Date())
    }
  }

  // Closes the stop the tick may have opened at T0, or deletes it if the signal shows it shorter
  // than the debounce it was opened under
  await closeOnRunning(sample.workCenterId, sample.occurredAt)
}

export interface ConfirmationTarget {
  workCenterId: string
  runModeTagId: string
}

// A decision logs its failure itself, once and with the cause, so its requests log theirs at debug
const DECISION_REQUEST = { failureLogLevel: 'debug' } as const

// One attempt of the tick at a pending decision: telemetry is asked and its answer decides. Any
// failure, of telemetry, MongoDB or Redis, defers the decision to its next attempt. The answer
// decides only if it saw every sample processed here: the cursor is read before telemetry is
// asked, and under the tag's lock the decision is made only while the record and the cursor are
// as they were. Otherwise the next tick asks again, with no attempt counted
async function attemptDecision<T>(
  target: ConfirmationTarget,
  decision: PendingDecision,
  now: Date,
  ask: () => Promise<T>,
  decide: (answer: T) => Promise<void>,
): Promise<void> {
  try {
    const cursorBefore = await readCursor(target.workCenterId, target.runModeTagId)
    const answer = await ask()
    await withTagLock(target, async () => {
      if (await unchangedSinceAsked(target, decision, cursorBefore)) await decide(answer)
    })
  } catch (err) {
    await withTagLock(target, () => deferDecision(target, decision, now, err))
  }
}

// The record still waits on the same stop, and no sample was processed since the cursor was read
async function unchangedSinceAsked(
  target: ConfirmationTarget,
  decision: PendingDecision,
  cursorBefore: Cursor | null,
): Promise<boolean> {
  const stored = await readDecision(decision.kind, target.workCenterId, target.runModeTagId)
  if (stored?.since !== decision.since) return false
  const cursor = await readCursor(target.workCenterId, target.runModeTagId)
  return cursorAt(cursor) === cursorAt(cursorBefore)
}

const cursorAt = (cursor: Cursor | null): number | null =>
  cursor ? cursor.lastProcessedOccurredAt.getTime() : null

// Rule 3: once D has run out, a candidate whose stopped sample is still the tag's latest one in
// telemetry has stood since T0, and its stop opens at T0
export async function confirmCandidate(
  target: ConfirmationTarget,
  now: Date = new Date(),
): Promise<void> {
  const candidate = await readDueDecision('debounce', target, now)
  if (!candidate) return

  await attemptDecision(
    target,
    candidate,
    now,
    () => getLatest(target.runModeTagId, DECISION_REQUEST),
    async latest => {
      if (!latest) {
        await dropDecisionOfUnknownTag(target, candidate)
        return
      }

      const firstStoppedAt = new Date(candidate.since)
      // A newer sample is one performance has not processed yet; rules 1 and 2 decide when it
      // arrives
      if (latest.value >= 1 || new Date(latest.occurredAt).getTime() !== firstStoppedAt.getTime()) {
        return
      }
      const covering = await plannedStopCovering(target.workCenterId, firstStoppedAt)
      if (!covering) {
        await openUnplannedFromRunMode(target.workCenterId, firstStoppedAt, candidate.debounceMs)
      } else if (covering.endedAt) {
        await writeCheckIfEarlier(target, covering.endedAt)
      }
      await resolveDecision(target, candidate, now)
    },
  )
}

// Rule 4: a planned stop that closed at E while the run mode could not be read left this check.
// Telemetry's history since E decides it, without a debounce. A check dropped after 24 hours hands
// the key on as a decided one does
export async function confirmAfterPlannedCheck(
  target: ConfirmationTarget,
  now: Date = new Date(),
): Promise<void> {
  const check = await readDueDecision('after_planned', target, now, dropped =>
    checkOfNextPlannedStop(target.workCenterId, new Date(dropped.since)),
  )
  if (!check) return

  const endedAt = new Date(check.since)
  // The history since E holds nothing until E has passed
  if (now.getTime() <= endedAt.getTime()) return
  await attemptDecision(
    target,
    check,
    now,
    () => getStateDurations(target.runModeTagId, endedAt, now, DECISION_REQUEST),
    async history => {
      if (!history) {
        await dropDecisionOfUnknownTag(target, check)
        return
      }

      // The segment that starts at E holds the state at E; a history that starts later cannot
      // tell it
      const [atEnd, ...later] = history.segments
      const stoppedAtEnd =
        atEnd && new Date(atEnd.start).getTime() === endedAt.getTime() && atEnd.state < 1
      // Another planned stop that covers E takes the time after E, as the close finds it when it
      // leaves no stop; the one that ended at E covers it no longer
      if (stoppedAtEnd && !(await plannedStopCovering(target.workCenterId, endedAt))) {
        const running = later.find(segment => segment.state >= 1)
        let endAt = running ? new Date(running.start) : null
        // The next planned stop's start would have closed the stop, had it been open then
        const nextStart = await nextPlannedStopStart(target.workCenterId, endedAt)
        if (nextStart && (!endAt || nextStart.getTime() < endAt.getTime())) endAt = nextStart
        if (endAt) {
          await recordClosedFromRunMode(target.workCenterId, endedAt, endAt)
        } else {
          await openUnplannedFromRunMode(target.workCenterId, endedAt)
        }
      }
      const next = await checkOfNextPlannedStop(target.workCenterId, endedAt)
      await resolveDecision(target, check, now, next)
    },
  )
}

// The start of the work center's first planned stop that started after E
async function nextPlannedStopStart(workCenterId: string, after: Date): Promise<Date | null> {
  const next = await PlannedStop.findOne({
    workCenterId: new Types.ObjectId(workCenterId),
    status: { $in: ['active', 'closed'] },
    actualStartAt: { $gt: after },
  })
    .sort({ actualStartAt: 1 })
    .select({ actualStartAt: 1 })
    .lean()
  return next?.actualStartAt ?? null
}

// The check the key goes on to once the check at E is decided or dropped. One key holds one check,
// so the work center's first planned stop that closed after E could not leave its own while this one
// waited
async function checkOfNextPlannedStop(
  workCenterId: string,
  after: Date,
): Promise<PendingDecision | undefined> {
  const next = await PlannedStop.findOne({
    workCenterId: new Types.ObjectId(workCenterId),
    status: 'closed',
    actualEndAt: { $gt: after },
  })
    .sort({ actualEndAt: 1 })
    .select({ actualEndAt: 1 })
    .lean()
  return next?.actualEndAt ? afterPlannedCheck(next.actualEndAt) : undefined
}

// Rule 4 as the planned stop closes at E: a stopped machine gets its stop at E. Telemetry's latest
// sample decides only if it is the state at E, a sample from E or before, and only if it saw every
// sample processed here, as the tick's answer does: a running signal processed while telemetry was
// asked would leave a stop at E that nothing closes. Otherwise, and when the run mode cannot be
// read, the check at E decides from the history
export async function checkRunModeAfterPlannedStop(
  target: ConfirmationTarget,
  endedAt: Date,
): Promise<void> {
  const cursorBefore = await readCursor(target.workCenterId, target.runModeTagId)
  // undefined when telemetry cannot answer; the request logs why
  const latest = await getLatest(target.runModeTagId).catch(() => undefined)
  // Telemetry does not know the tag
  if (latest === null) return
  const stateAtEnd =
    latest && new Date(latest.occurredAt).getTime() <= endedAt.getTime() ? latest.value : undefined
  await withTagLock(target, async () => {
    const cursor = await readCursor(target.workCenterId, target.runModeTagId)
    if (stateAtEnd !== undefined && cursorAt(cursor) === cursorAt(cursorBefore)) {
      if (stateAtEnd < 1) await openUnplannedFromRunMode(target.workCenterId, endedAt)
      return
    }
    await writeCheckIfEarlier(target, endedAt)
  })
}

// Rule 4 as the planned stop closes at E when the run mode cannot be read at all, such as when
// work-center cannot name the tag
export async function leaveAfterPlannedCheck(
  target: ConfirmationTarget,
  endedAt: Date,
): Promise<void> {
  await withTagLock(target, () => writeCheckIfEarlier(target, endedAt))
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

// The tag of the work center's latest processed run-mode signal, for when work-center cannot
// answer
export async function runModeTagIdFromCursor(workCenterId: string): Promise<string | null> {
  const cursor = await RunModeProcessingState.findOne({
    workCenterId: new Types.ObjectId(workCenterId),
  })
    .sort({ lastProcessedOccurredAt: -1 })
    .select({ runModeTagId: 1 })
    .lean()
  return cursor ? cursor.runModeTagId.toString() : null
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
