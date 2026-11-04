import { setTimeout as sleep } from 'node:timers/promises'
import { Types } from 'mongoose'
import {
  listRunModeMonitors,
  type RunModeMonitor,
} from '../lib/internal-api/run-mode-monitors.client.js'
import {
  getById as getWorkCenter,
  invalidate as invalidateWorkCenter,
  type WorkCenterSnapshot,
} from '../lib/internal-api/work-center.client.js'
import { logger } from '../lib/logger.js'
import { deleteDecision, retryDelayMs } from '../modules/run-mode/run-mode.decisions.js'
import { withTagLock } from '../modules/run-mode/run-mode.lock.js'
import {
  listMonitoredFromCursors,
  type MonitoredWorkCenter,
} from '../modules/run-mode/run-mode.processor.js'
import { reconcileUntilDone } from '../modules/run-mode/run-mode.reconciler.js'
import { RunModeProcessingState } from '../modules/run-mode/run-mode-processing-state.model.js'
import type { IUnplannedStop } from '../modules/unplanned-stop/unplanned-stop.model.js'
import { closeIfOpen } from '../modules/unplanned-stop/unplanned-stop.service.js'

// The work center each monitored run-mode tag belongs to; the stream's samples are routed by it.
// Only an answer from work-center changes it: while work-center cannot answer, a work center keeps
// its tag, so its samples go on being processed
const workCenterByTag = new Map<string, string>()

export function workCenterForTag(tagId: string): string | undefined {
  return workCenterByTag.get(tagId)
}

// Startup maps the work centers whose samples were processed before, from their cursors, so their
// samples are routed before work-center has answered
export async function seedFromCursors(): Promise<void> {
  for (const { workCenterId, runModeTagId } of await listMonitoredFromCursors()) {
    workCenterByTag.set(runModeTagId, workCenterId)
  }
}

// Aborted by stopRefresh: the refresh and every reconciliation the tag map started end with it
let lifetime = new AbortController()
let refresh: Promise<void> | null = null
let refreshAgain = false
const reconciliations = new Map<string, { abort: AbortController; done: Promise<void> }>()

const keyOf = (target: MonitoredWorkCenter): string =>
  `${target.workCenterId}:${target.runModeTagId}`

// Work-center lists a work center as monitored when it is physical, active and has a run-mode tag.
// An event applies the same test to the work center it reads, so the two never disagree
function monitoredTagOf(workCenter: WorkCenterSnapshot | null): string | undefined {
  if (workCenter?.type !== 'physical' || workCenter.status !== 'active') return undefined
  return workCenter.tagBindings?.runModeTagId
}

// A work_center.* event. Work-center is read first, and only its answer changes the map. When it
// cannot answer, or the old tag's state cannot be deleted, the work center keeps its mapping and the
// full refresh retries; either way the event is acknowledged, so it is never dead-lettered. While a
// refresh runs, the event leaves the work center to it: the refresh reads the list once more after
// an event that came while it ran, and the two never apply different answers in turn
export async function syncWorkCenter(workCenterId: string): Promise<void> {
  await invalidateWorkCenter(workCenterId)
  if (refresh) {
    requestRefresh()
    return
  }
  try {
    const runModeTagId = monitoredTagOf(await getWorkCenter(workCenterId))
    for (const [tagId, mapped] of [...workCenterByTag]) {
      if (mapped === workCenterId && tagId !== runModeTagId) {
        await stopMonitoring(
          { workCenterId, runModeTagId: tagId },
          { closeOpenStop: runModeTagId === undefined },
        )
      }
    }
    if (runModeTagId) await startMonitoring({ workCenterId, runModeTagId })
  } catch (err) {
    // A read that fails logs why work-center could not answer, and the refresh logs a failure that
    // lasts
    logger.debug('Run-mode tag map left a work center to the full refresh', {
      event: 'run_mode.tag_map.sync_failed',
      workCenterId,
      error: err instanceof Error ? err.message : err,
    })
    requestRefresh()
  }
}

// One refresh at a time. A request while one runs makes it read the list once more when it is done,
// so a change after its read is not missed
export function requestRefresh(): void {
  if (refresh) {
    refreshAgain = true
    return
  }
  refresh = refreshUntilDone(lifetime.signal).finally(() => {
    refresh = null
  })
}

// Reads the monitored work centers until work-center answers, on the retry schedule, and makes the
// map what the list says. Logs mark changes, not attempts: the first failure, with its cause, and the
// refresh after failures. Its requests log their failures at debug
async function refreshUntilDone(signal: AbortSignal): Promise<void> {
  let failures = 0
  while (!signal.aborted) {
    // The list read next covers every event that came before it
    refreshAgain = false
    try {
      await replaceMapping(await listRunModeMonitors({ failureLogLevel: 'debug', signal }))
      if (failures > 0) {
        logger.info('Run-mode tag map refreshed after failing', {
          event: 'run_mode.tag_map.refresh_recovered',
          attempts: failures,
        })
        failures = 0
      }
      if (!refreshAgain) return
      continue
    } catch (err) {
      if (signal.aborted) return
      failures++
      if (failures === 1) {
        logger.warn('Run-mode tag map could not be refreshed; retrying until it is', {
          event: 'run_mode.tag_map.refresh_failed',
          error: err instanceof Error ? err.message : err,
          // Why work-center could not answer: the HTTP status or the fetch error
          ...(err instanceof Error && typeof err.cause === 'string' ? { cause: err.cause } : {}),
        })
      }
    }
    // Stopping ends the wait at once
    await sleep(retryDelayMs(failures), undefined, { signal }).catch(() => {})
  }
}

// Every work center the list leaves out, or lists with another tag, stops being monitored; every one
// it lists that the map does not hold yet starts
async function replaceMapping(monitors: RunModeMonitor[]): Promise<void> {
  const listed = new Map(monitors.map(m => [m.runModeTagId, m.workCenterId]))
  const monitored = new Set(listed.values())
  for (const [runModeTagId, workCenterId] of [...workCenterByTag]) {
    if (listed.get(runModeTagId) !== workCenterId) {
      await stopMonitoring(
        { workCenterId, runModeTagId },
        { closeOpenStop: !monitored.has(workCenterId) },
      )
    }
  }
  for (const [runModeTagId, workCenterId] of listed) {
    await startMonitoring({ workCenterId, runModeTagId })
  }
}

// A tag new to the work center is mapped and reconciled, in the background; with no cursor, the
// reconciliation starts the tag from its latest sample. A tag routes to one work center, so one that
// had it stops being monitored first
async function startMonitoring(target: MonitoredWorkCenter): Promise<void> {
  const mapped = workCenterByTag.get(target.runModeTagId)
  if (mapped === target.workCenterId) return
  if (mapped) await stopMonitoring({ workCenterId: mapped, runModeTagId: target.runModeTagId })
  workCenterByTag.set(target.runModeTagId, target.workCenterId)

  const key = keyOf(target)
  const abort = new AbortController()
  const done = reconcileUntilDone(target, AbortSignal.any([lifetime.signal, abort.signal])).finally(
    () => {
      if (reconciliations.get(key)?.done === done) reconciliations.delete(key)
    },
  )
  reconciliations.set(key, { abort, done })
}

// A work center that stops being monitored loses its cursor and its tag's pending decisions of both
// kinds: the tag no longer decides for it, and monitoring that resumes starts from the latest sample
// instead of replaying the time between. A reconciliation of the tag still going on is cancelled
// first, and the deletes take the tag's lock, so they come after a decision in flight. When they
// fail, the tag stays mapped, so the refresh that retries finds it. A work center no longer monitored
// at all, archived, deleted or without a run-mode tag, also gets its open run-mode stop closed at that
// moment and kept: nothing tells the stop's end after it. One whose tag changed keeps the stop open,
// for the new tag's first running signal to close
async function stopMonitoring(
  target: MonitoredWorkCenter,
  { closeOpenStop = false }: { closeOpenStop?: boolean } = {},
): Promise<void> {
  workCenterByTag.delete(target.runModeTagId)
  let closed: IUnplannedStop | null
  try {
    const reconciliation = reconciliations.get(keyOf(target))
    reconciliation?.abort.abort()
    await reconciliation?.done
    closed = await withTagLock(target, async () => {
      await deleteDecision('debounce', target.workCenterId, target.runModeTagId)
      await deleteDecision('after_planned', target.workCenterId, target.runModeTagId)
      await RunModeProcessingState.deleteOne({
        workCenterId: new Types.ObjectId(target.workCenterId),
        runModeTagId: new Types.ObjectId(target.runModeTagId),
      })
      if (!closeOpenStop) return null
      return closeIfOpen(target.workCenterId, new Date(), { source: 'run_mode' })
    })
  } catch (err) {
    workCenterByTag.set(target.runModeTagId, target.workCenterId)
    throw err
  }
  logger.info('Run-mode monitoring stopped; the cursor and pending decisions of the tag are gone', {
    event: 'run_mode.tag_map.unmonitored',
    workCenterId: target.workCenterId,
    runModeTagId: target.runModeTagId,
    ...(closed ? { closedStopId: closed._id.toString() } : {}),
  })
}

// Cancels the refresh and the reconciliations still waiting, and aborts their requests in flight. It
// resolves once what is being written is written, so nothing is written after the data connections
// close
export async function stopRefresh(): Promise<void> {
  lifetime.abort()
  await refresh
  await Promise.all([...reconciliations.values()].map(reconciliation => reconciliation.done))
  lifetime = new AbortController()
}

export const __test__ = { workCenterByTag }
