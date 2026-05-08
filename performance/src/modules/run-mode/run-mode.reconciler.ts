import { Types } from 'mongoose'
import { getLatest, getStateDurations } from '../../lib/internal-api/run-mode-telemetry.client.js'
import { logger } from '../../lib/logger.js'
import {
  handleRunModeSample,
  listMonitoredFromCursors,
  type MonitoredWorkCenter,
} from './run-mode.processor.js'
import { RunModeProcessingState } from './run-mode-processing-state.model.js'

export interface ReconcileOptions {
  now?: Date
  monitored?: MonitoredWorkCenter[]
}

export async function reconcileOnBoot(options: ReconcileOptions = {}): Promise<void> {
  const now = options.now ?? new Date()
  const monitored = options.monitored ?? (await listMonitoredFromCursors())
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

  await Promise.all(monitored.map(m => reconcileOne(m, now)))

  logger.info('Run-mode reconciler completed', {
    event: 'run_mode.reconciler.done',
  })
}

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

async function reconcileOne(target: MonitoredWorkCenter, now: Date): Promise<void> {
  try {
    const cursor = await readCursor(target)

    if (cursor) {
      const segments = await getStateDurations(target.runModeTagId, cursor, now)
      if (segments.length > 0) {
        for (const seg of segments) {
          const occurredAt = new Date(seg.from)
          if (occurredAt.getTime() <= cursor.getTime()) continue
          await handleRunModeSample({
            workCenterId: target.workCenterId,
            runModeTagId: target.runModeTagId,
            value: seg.value,
            occurredAt,
          })
        }
        return
      }
      // Cursor exists but state-durations is empty — nothing to replay.
      return
    }

    // No cursor: fall back to latest value (debounce-aware via handleRunModeSample).
    const latest = await getLatest(target.runModeTagId)
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
  } catch (err) {
    logger.warn('Run-mode reconciler failed for work center', {
      event: 'run_mode.reconciler.failed',
      workCenterId: target.workCenterId,
      runModeTagId: target.runModeTagId,
      error: err instanceof Error ? err.message : err,
    })
  }
}
