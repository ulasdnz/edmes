import { logger } from '../../lib/logger.js'
import { redisClient } from '../../lib/redis.js'

export interface PendingDecision {
  kind: 'debounce' | 'after_planned'
  since: string
  debounceMs: number
  attempts: number
  nextAttemptAt: string | null
}

export type DecisionKind = PendingDecision['kind']

export interface DecisionTarget {
  workCenterId: string
  runModeTagId: string
}

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

// True when there was a decision to delete
export async function deleteDecision(
  kind: DecisionKind,
  workCenterId: string,
  runModeTagId: string,
): Promise<boolean> {
  return (await redisClient.del(decisionKey(kind, workCenterId, runModeTagId))) === 1
}

// The wait after the given number of failed attempts: 1, 2, 4, 8 and 16 s, then 30 s
export function retryDelayMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(attempts - 1, 0), 30_000)
}

// Replaces the stored record, or deletes it when no new value is given, only while it has the given
// since, in one step: a tick that gets its answer late must not bring back a record a running
// signal decided meanwhile, nor touch the record of a newer stop
const REPLACE_IF_SAME_SINCE = `
local stored = redis.call('GET', KEYS[1])
if not stored or cjson.decode(stored).since ~= ARGV[1] then return 0 end
if ARGV[2] then redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') else redis.call('DEL', KEYS[1]) end
return 1
`

async function replaceIfSameSince(
  target: DecisionTarget,
  decision: PendingDecision,
  replacement?: PendingDecision,
): Promise<boolean> {
  const key = decisionKey(decision.kind, target.workCenterId, target.runModeTagId)
  const args = replacement ? [decision.since, JSON.stringify(replacement)] : [decision.since]
  return (await redisClient.eval(REPLACE_IF_SAME_SINCE, 1, key, ...args)) === 1
}

// Every stored decision. SCAN matches the stored key names, which carry the client's key prefix,
// and it can return a key twice
export async function listPendingDecisions(): Promise<(DecisionTarget & { kind: DecisionKind })[]> {
  const pending: (DecisionTarget & { kind: DecisionKind })[] = []
  for (const kind of Object.keys(KEY_PREFIXES) as DecisionKind[]) {
    const prefix = `${redisClient.options.keyPrefix ?? ''}${KEY_PREFIXES[kind]}`
    const keys = new Set<string>()
    let cursor = '0'
    do {
      const [next, found] = await redisClient.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
      cursor = next
      for (const key of found) keys.add(key)
    } while (cursor !== '0')

    for (const key of keys) {
      const parts = key.slice(prefix.length).split(':')
      if (parts.length < 2) continue
      pending.push({
        kind,
        workCenterId: parts.slice(0, -1).join(':'),
        runModeTagId: parts[parts.length - 1],
      })
    }
  }
  return pending
}

const logFields = (target: DecisionTarget, decision: PendingDecision) => ({
  kind: decision.kind,
  workCenterId: target.workCenterId,
  runModeTagId: target.runModeTagId,
  since: decision.since,
})

// The decision the tick asks telemetry about now: its D has run out, which only the clock can tell
// because the absence of a signal proves nothing, and the wait after its last failed attempt is
// over. One still undecided after 24 hours is dropped instead
export async function readDueDecision(
  kind: DecisionKind,
  target: DecisionTarget,
  now: Date,
): Promise<PendingDecision | null> {
  const decision = await readDecision(kind, target.workCenterId, target.runModeTagId)
  if (!decision) return null

  const since = new Date(decision.since).getTime()
  if (now.getTime() - since > DECISION_LIMIT_MS) {
    if (await replaceIfSameSince(target, decision)) {
      logger.error('Run-mode decision dropped undecided after 24 hours; a stop may be lost', {
        event: 'run_mode.decision.abandoned',
        ...logFields(target, decision),
        attempts: decision.attempts,
      })
    }
    return null
  }

  const retryAt = decision.nextAttemptAt === null ? 0 : new Date(decision.nextAttemptAt).getTime()
  return now.getTime() >= Math.max(since + decision.debounceMs, retryAt) ? decision : null
}

// Telemetry could not answer: the question is asked again on the retry schedule. Only the first
// failure is logged, and a decision another writer made meanwhile stays made
export async function deferDecision(
  target: DecisionTarget,
  decision: PendingDecision,
  now: Date,
  error: unknown,
): Promise<void> {
  const attempts = decision.attempts + 1
  const nextAttemptAt = new Date(now.getTime() + retryDelayMs(attempts)).toISOString()
  const deferred = await replaceIfSameSince(target, decision, {
    ...decision,
    attempts,
    nextAttemptAt,
  })
  if (!deferred || decision.attempts > 0) return
  logger.warn('Run-mode decision deferred until telemetry answers', {
    event: 'run_mode.decision.deferred',
    ...logFields(target, decision),
    nextAttemptAt,
    error: error instanceof Error ? error.message : error,
  })
}

// The decided record goes, unless another writer has replaced it with a newer one meanwhile
export async function resolveDecision(
  target: DecisionTarget,
  decision: PendingDecision,
  now: Date,
): Promise<void> {
  if (await replaceIfSameSince(target, decision)) logDecisionResolved(target, decision, now)
}

// Ends the wait the deferral log started; waitedMs counts from the moment the decision was due
export function logDecisionResolved(
  target: DecisionTarget,
  decision: PendingDecision,
  now: Date,
): void {
  if (decision.attempts === 0) return
  logger.info('Deferred run-mode decision made', {
    event: 'run_mode.decision.resolved',
    ...logFields(target, decision),
    attempts: decision.attempts,
    waitedMs: now.getTime() - (new Date(decision.since).getTime() + decision.debounceMs),
  })
}

// Telemetry does not know the tag, so no decision can be made for it any more
export async function dropDecisionOfUnknownTag(
  target: DecisionTarget,
  decision: PendingDecision,
): Promise<void> {
  if (!(await replaceIfSameSince(target, decision))) return
  logger.warn('Run-mode decision dropped: telemetry does not know the tag', {
    event: 'run_mode.decision.unknown_tag',
    ...logFields(target, decision),
  })
}
