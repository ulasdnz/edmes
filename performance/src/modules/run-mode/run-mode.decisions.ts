import { redisClient } from '../../lib/redis.js'

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

// Decisions go through the raw client, not the cache helpers: those turn a Redis error into "not
// found" or "skipped", and a decision lost that way is a stop lost. Here every error reaches the
// caller, so the sample fails and the stream redelivers it
export async function readDecision(
  kind: DecisionKind,
  workCenterId: string,
  runModeTagId: string,
): Promise<PendingDecision | null> {
  const raw = await redisClient.get(decisionKey(kind, workCenterId, runModeTagId))
  return raw === null ? null : (JSON.parse(raw) as PendingDecision)
}

export async function writeDecision(
  workCenterId: string,
  runModeTagId: string,
  decision: PendingDecision,
): Promise<void> {
  const key = decisionKey(decision.kind, workCenterId, runModeTagId)
  await redisClient.set(key, JSON.stringify(decision), 'EX', DECISION_TTL_SECONDS)
}

// Writes the decision only when none of its kind is stored, in one command: the first write wins
export async function writeDecisionIfAbsent(
  workCenterId: string,
  runModeTagId: string,
  decision: PendingDecision,
): Promise<void> {
  const key = decisionKey(decision.kind, workCenterId, runModeTagId)
  await redisClient.set(key, JSON.stringify(decision), 'EX', DECISION_TTL_SECONDS, 'NX')
}

export async function deleteDecision(
  kind: DecisionKind,
  workCenterId: string,
  runModeTagId: string,
): Promise<void> {
  await redisClient.del(decisionKey(kind, workCenterId, runModeTagId))
}

// The wait after the given number of failed attempts: 1, 2, 4, 8 and 16 s, then 30 s
export function retryDelayMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(attempts - 1, 0), 30_000)
}
