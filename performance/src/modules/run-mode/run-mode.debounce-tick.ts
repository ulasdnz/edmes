import { logger } from '../../lib/logger.js'
import { redisClient } from '../../lib/redis.js'
import { confirmCandidate } from './run-mode.processor.js'

const TICK_INTERVAL_MS = 1000
const CANDIDATE_PREFIX = 'runmode:candidate:'

let tickTimer: NodeJS.Timeout | null = null
let running = false

async function scanCandidates(): Promise<void> {
  let cursor = '0'
  const matched: string[] = []
  do {
    const [next, keys] = await redisClient.scan(
      cursor,
      'MATCH',
      `${CANDIDATE_PREFIX}*`,
      'COUNT',
      200,
    )
    cursor = next
    matched.push(...keys)
  } while (cursor !== '0')

  if (matched.length === 0) return

  const prefix = `${redisClient.options.keyPrefix ?? ''}${CANDIDATE_PREFIX}`
  for (const full of matched) {
    const unprefixed = full.startsWith(prefix) ? full.slice(prefix.length) : full
    const parts = unprefixed.split(':')
    if (parts.length < 2) continue
    const runModeTagId = parts[parts.length - 1]
    const workCenterId = parts.slice(0, -1).join(':')
    try {
      await confirmCandidate({ workCenterId, runModeTagId })
    } catch (err) {
      logger.warn('Run-mode debounce tick failed for candidate', {
        event: 'run_mode.debounce_tick.failed',
        workCenterId,
        runModeTagId,
        error: err instanceof Error ? err.message : err,
      })
    }
  }
}

export function startDebounceTick(): void {
  if (running) return
  running = true
  const loop = (): void => {
    if (!running) return
    void scanCandidates().finally(() => {
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
