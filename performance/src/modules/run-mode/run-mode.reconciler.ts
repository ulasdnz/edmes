import { setTimeout as sleep } from 'node:timers/promises'
import { Types } from 'mongoose'
import {
  getLatest,
  type RunModeRequestOptions,
} from '../../lib/internal-api/run-mode-telemetry.client.js'
import { logger } from '../../lib/logger.js'
import { retryDelayMs } from './run-mode.decisions.js'
import {
  handleRunModeSample,
  listMonitoredFromCursors,
  MAX_REPLAY_PAGES,
  type MonitoredWorkCenter,
  replayStoredSamples,
} from './run-mode.processor.js'
import { RunModeProcessingState } from './run-mode-processing-state.model.js'

async function readCursor(target: MonitoredWorkCenter): Promise<Date | null> {
  const doc = await RunModeProcessingState.findOne({
    workCenterId: new Types.ObjectId(target.workCenterId),
    runModeTagId: new Types.ObjectId(target.runModeTagId),
  })
    .select({ lastProcessedOccurredAt: 1 })
    .lean()
  return doc?.lastProcessedOccurredAt ?? null
}

async function initializeCursor(
  target: MonitoredWorkCenter,
  occurredAt: Date,
  value: number,
): Promise<void> {
  await RunModeProcessingState.findOneAndUpdate(
    {
      workCenterId: new Types.ObjectId(target.workCenterId),
      runModeTagId: new Types.ObjectId(target.runModeTagId),
    },
    { $set: { lastProcessedOccurredAt: occurredAt, lastProcessedValue: value } },
    { upsert: true },
  )
}

// Brings one work center up to `now` from telemetry: the samples stored after its cursor go through
// the same rules as delivered ones, and without a cursor its latest sample does. It throws when it
// cannot, such as when telemetry cannot answer, and logs nothing itself, so its requests log their
// failures at debug: the caller that retries it logs the failure once, with the cause. Once the
// signal aborts, it stops before its next request or replayed sample
export async function reconcileWorkCenter(
  target: MonitoredWorkCenter,
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<void> {
  const request: RunModeRequestOptions = { failureLogLevel: 'debug', signal }
  const cursor = await readCursor(target)

  if (cursor) {
    const { complete } = await replayStoredSamples(target, cursor, now, request)
    if (!complete) {
      logger.warn(
        'Run-mode reconciler hit MAX_ITER cap; remaining transitions deferred to next boot',
        {
          event: 'run_mode.reconciler.max_iter',
          workCenterId: target.workCenterId,
          runModeTagId: target.runModeTagId,
          maxIter: MAX_REPLAY_PAGES,
        },
      )
    }
    return
  }

  // No cursor: fall back to latest value (debounce-aware via handleRunModeSample).
  const latest = await getLatest(target.runModeTagId, request)
  if (!latest) return
  const occurredAt = new Date(latest.occurredAt)
  if (latest.value >= 1) {
    // Running: just initialize the cursor so future events are tracked.
    await initializeCursor(target, occurredAt, latest.value)
    return
  }
  await handleRunModeSample({
    workCenterId: target.workCenterId,
    runModeTagId: target.runModeTagId,
    value: latest.value,
    occurredAt,
  })
}

// Retries one work center on the retry schedule until it succeeds, apart from the others, so one that
// keeps failing holds up no other. Logs mark changes, not attempts: the first failure, with its
// cause, and the success after it
async function reconcileUntilDone(target: MonitoredWorkCenter, signal: AbortSignal): Promise<void> {
  let failures = 0
  while (!signal.aborted) {
    try {
      await reconcileWorkCenter(target, new Date(), signal)
      if (failures > 0) {
        logger.info('Run-mode reconciler recovered for work center', {
          event: 'run_mode.reconciler.recovered',
          workCenterId: target.workCenterId,
          runModeTagId: target.runModeTagId,
          attempts: failures,
        })
      }
      return
    } catch (err) {
      if (signal.aborted) return
      failures++
      if (failures === 1) {
        logger.warn('Run-mode reconciler failed for work center; retrying until it succeeds', {
          event: 'run_mode.reconciler.failed',
          workCenterId: target.workCenterId,
          runModeTagId: target.runModeTagId,
          error: err instanceof Error ? err.message : err,
          // Why telemetry could not answer: the HTTP status, the fetch error or the timeout
          ...(err instanceof Error && typeof err.cause === 'string' ? { cause: err.cause } : {}),
        })
      }
    }
    // Stopping ends the wait at once
    await sleep(retryDelayMs(failures), undefined, { signal }).catch(() => {})
  }
}

let boot: { controller: AbortController; done: Promise<void> } | null = null

// Reconciles every work center that has a cursor, each on its own and in the background: startup
// waits only for the list, so telemetry being down at boot only delays the reconciliation
export async function startBootReconciliation(): Promise<void> {
  if (boot) return
  const monitored = await listMonitoredFromCursors()
  if (monitored.length === 0) {
    logger.info('Run-mode reconciler: no monitored work centers', {
      event: 'run_mode.reconciler.empty',
    })
    return
  }

  logger.info('Run-mode reconciler started', {
    event: 'run_mode.reconciler.start',
    count: monitored.length,
  })
  const controller = new AbortController()
  const done = Promise.all(
    monitored.map(target => reconcileUntilDone(target, controller.signal)),
  ).then(() => {
    if (controller.signal.aborted) return
    logger.info('Run-mode reconciler completed', {
      event: 'run_mode.reconciler.done',
    })
  })
  boot = { controller, done }
}

// Cancels the retries still waiting and aborts the requests in flight. It resolves once the sample
// being written is written, so nothing is written after the data connections close
export async function stopBootReconciliation(): Promise<void> {
  if (!boot) return
  const { controller, done } = boot
  boot = null
  controller.abort()
  await done
}
