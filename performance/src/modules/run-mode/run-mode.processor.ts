import { Types } from 'mongoose'
import { cacheDel, cacheGet, cacheSet } from '../../lib/cache.js'
import { getLatest } from '../../lib/internal-api/telemetry.client.js'
import { getById as getWorkCenter } from '../../lib/internal-api/work-center.client.js'
import { logger } from '../../lib/logger.js'
import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import { resolveForWorkCenter } from '../policy/policy.service.js'
import {
  closeIfOpen as closeOpenUnplanned,
  openFromRunMode as openUnplannedFromRunMode,
} from '../unplanned-stop/unplanned-stop.service.js'
import { RunModeProcessingState } from './run-mode-processing-state.model.js'

export interface RunModeSample {
  workCenterId: string
  runModeTagId: string
  value: number
  occurredAt: Date
}

interface Candidate {
  firstStoppedAt: string
  runModeTagId: string
  debounceMs: number
}

const candidateKey = (workCenterId: string, runModeTagId: string): string =>
  `runmode:candidate:${workCenterId}:${runModeTagId}`

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

  if (sample.value < 1) {
    await handleStopped(sample)
  } else {
    await handleRunning(sample)
  }

  await updateCursor(sample)
}

async function handleStopped(sample: RunModeSample): Promise<void> {
  if (await plannedStopCovers(sample.workCenterId, sample.occurredAt)) return

  const policy = await resolveForWorkCenter(sample.workCenterId)
  if (policy.runModeDebounceMs === 0) {
    await openUnplannedFromRunMode(sample.workCenterId, sample.occurredAt)
    return
  }

  const candidate: Candidate = {
    firstStoppedAt: sample.occurredAt.toISOString(),
    runModeTagId: sample.runModeTagId,
    debounceMs: policy.runModeDebounceMs,
  }
  const ttlSeconds = Math.max(1, Math.ceil((policy.runModeDebounceMs + 2000) / 1000))
  await cacheSet(candidateKey(sample.workCenterId, sample.runModeTagId), candidate, ttlSeconds)
}

async function handleRunning(sample: RunModeSample): Promise<void> {
  await cacheDel(candidateKey(sample.workCenterId, sample.runModeTagId))
  await closeOpenUnplanned(sample.workCenterId, sample.occurredAt)
}

export interface ConfirmationTarget {
  workCenterId: string
  runModeTagId: string
}

export async function confirmCandidate(target: ConfirmationTarget): Promise<void> {
  const key = candidateKey(target.workCenterId, target.runModeTagId)
  const candidate = await cacheGet<Candidate>(key)
  if (!candidate) return

  const firstStoppedAt = new Date(candidate.firstStoppedAt)
  const maturedAt = firstStoppedAt.getTime() + candidate.debounceMs
  if (Date.now() < maturedAt) return

  const latest = await getLatest(target.runModeTagId)
  if (!latest || latest.value >= 1) {
    await cacheDel(key)
    return
  }

  if (await plannedStopCovers(target.workCenterId, firstStoppedAt)) {
    await cacheDel(key)
    return
  }

  await openUnplannedFromRunMode(target.workCenterId, firstStoppedAt)
  await cacheDel(key)
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
