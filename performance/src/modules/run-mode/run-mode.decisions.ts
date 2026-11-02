import { cacheDel, cacheGet, cacheSet } from '../../lib/cache.js'

export interface PendingDecision {
  kind: 'debounce' | 'after_planned'
  since: string
  debounceMs: number
  attempts: number
  nextAttemptAt: string | null
}

export type DecisionKind = PendingDecision['kind']

// A decision still open after 24 hours is dropped; the 25-hour TTL only clears orphaned keys
export const DECISION_LIMIT_MS = 86_400_000
const DECISION_TTL_SECONDS = 90_000

const KEY_PREFIXES: Record<DecisionKind, string> = {
  debounce: 'runmode:candidate:',
  after_planned: 'runmode:after-planned:',
}

export const decisionKey = (
  kind: DecisionKind,
  workCenterId: string,
  runModeTagId: string,
): string => `${KEY_PREFIXES[kind]}${workCenterId}:${runModeTagId}`

export function readDecision(
  kind: DecisionKind,
  workCenterId: string,
  runModeTagId: string,
): Promise<PendingDecision | null> {
  return cacheGet<PendingDecision>(decisionKey(kind, workCenterId, runModeTagId))
}

export function writeDecision(
  workCenterId: string,
  runModeTagId: string,
  decision: PendingDecision,
): Promise<void> {
  const key = decisionKey(decision.kind, workCenterId, runModeTagId)
  return cacheSet(key, decision, DECISION_TTL_SECONDS)
}

export function deleteDecision(
  kind: DecisionKind,
  workCenterId: string,
  runModeTagId: string,
): Promise<void> {
  return cacheDel(decisionKey(kind, workCenterId, runModeTagId))
}

// The wait after the given number of failed attempts: 1, 2, 4, 8 and 16 s, then 30 s
export function retryDelayMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(attempts - 1, 0), 30_000)
}
