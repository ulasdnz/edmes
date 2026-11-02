import { logger } from '../../lib/logger.js'
import { listPendingDecisions } from './run-mode.decisions.js'
import { confirmAfterPlannedCheck, confirmCandidate } from './run-mode.processor.js'

const TICK_INTERVAL_MS = 1000

let tickTimer: NodeJS.Timeout | null = null
let running = false

// Asks about every pending decision at once, so a telemetry request that hangs for one tag holds
// up no other work center. A decision that fails defers itself; only a record that could not be
// read, or a deferral that could not be written, fails here
export async function runDecisionTick(now: Date): Promise<void> {
  const pending = await listPendingDecisions()
  await Promise.all(
    pending.map(async ({ kind, ...target }) => {
      try {
        if (kind === 'debounce') await confirmCandidate(target, now)
        else await confirmAfterPlannedCheck(target, now)
      } catch (err) {
        logger.warn('Run-mode debounce tick could not read or defer a pending decision', {
          event: 'run_mode.debounce_tick.failed',
          kind,
          workCenterId: target.workCenterId,
          runModeTagId: target.runModeTagId,
          error: err instanceof Error ? err.message : err,
        })
      }
    }),
  )
}

export function startDebounceTick(): void {
  if (running) return
  running = true
  // Logs mark changes: the first tick that cannot list the pending decisions, and the first that
  // can again
  let listingFails = false
  const loop = (): void => {
    if (!running) return
    runDecisionTick(new Date())
      .then(
        () => {
          if (!listingFails) return
          listingFails = false
          logger.info('Run-mode debounce tick lists pending decisions again', {
            event: 'run_mode.debounce_tick.scan_recovered',
          })
        },
        err => {
          // Redis could not list the pending decisions; the next tick asks again
          if (listingFails) return
          listingFails = true
          logger.warn('Run-mode debounce tick could not list pending decisions', {
            event: 'run_mode.debounce_tick.scan_failed',
            error: err instanceof Error ? err.message : err,
          })
        },
      )
      .finally(() => {
        if (running) tickTimer = setTimeout(loop, TICK_INTERVAL_MS)
      })
  }
  tickTimer = setTimeout(loop, TICK_INTERVAL_MS)
  logger.info('Run-mode debounce tick started', {
    event: 'run_mode.debounce_tick.start',
    intervalMs: TICK_INTERVAL_MS,
  })
}

export function stopDebounceTick(): void {
  running = false
  if (tickTimer) {
    clearTimeout(tickTimer)
    tickTimer = null
  }
  logger.info('Run-mode debounce tick stopped', { event: 'run_mode.debounce_tick.stop' })
}
