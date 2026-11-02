import { logger } from '../../lib/logger.js'
import { redisClient } from '../../lib/redis.js'
import { withTagLock } from './run-mode.lock.js'

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

// The check after a planned stop that ended at endedAt: the history since then decides it
export const afterPlannedCheck = (endedAt: Date): PendingDecision => ({
  kind: 'after_planned',
  since: endedAt.toISOString(),
  debounceMs: 0,
  attempts: 0,
  nextAttemptAt: null,
})

// Writes the check unless one for the same or an earlier end is pending, in one step. One key holds
// the earliest check; deciding it hands the key on to the next planned stop that closed. Every since
// is an ISO 8601 UTC string of one length, so their string order is their time order
const WRITE_IF_EARLIER = `
local stored = redis.call('GET', KEYS[1])
if stored and cjson.decode(stored).since <= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`

export async function writeCheckIfEarlier(target: DecisionTarget, endedAt: Date): Promise<void> {
  const check = afterPlannedCheck(endedAt)
  const key = decisionKey(check.kind, target.workCenterId, target.runModeTagId)
  await redisClient.eval(
    WRITE_IF_EARLIER,
    1,
    key,
    check.since,
    JSON.stringify(check),
    DECISION_TTL_SECONDS,
  )
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
// signal decided meanwhile, nor touch the record of a newer stop. A record that waits on another
// stop gets a TTL of its own; one that only gets new retry fields keeps the TTL it was written with
const REPLACE_IF_SAME_SINCE = `
local stored = redis.call('GET', KEYS[1])
if not stored or cjson.decode(stored).since ~= ARGV[1] then return 0 end
if not ARGV[2] then
  redis.call('DEL', KEYS[1])
elseif ARGV[3] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
else
  redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
end
return 1
`

async function replaceIfSameSince(
  target: DecisionTarget,
  decision: PendingDecision,
  replacement?: PendingDecision,
): Promise<boolean> {
  const key = decisionKey(decision.kind, target.workCenterId, target.runModeTagId)
  const args: (string | number)[] = [decision.since]
  if (replacement) args.push(JSON.stringify(replacement))
  if (replacement && replacement.since !== decision.since) args.push(DECISION_TTL_SECONDS)
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
// over. One still undecided after 24 hours is dropped instead, once its next attempt has come
export async function readDueDecision(
  kind: DecisionKind,
  target: DecisionTarget,
  now: Date,
  successor: (dropped: PendingDecision) => Promise<PendingDecision | undefined> = async () =>
    undefined,
): Promise<PendingDecision | null> {
  const decision = await readDecision(kind, target.workCenterId, target.runModeTagId)
  if (!decision) return null

  const retryAt = decision.nextAttemptAt === null ? 0 : new Date(decision.nextAttemptAt).getTime()
  if (now.getTime() < retryAt) return null

  const since = new Date(decision.since).getTime()
  if (now.getTime() - since > DECISION_LIMIT_MS) {
    await withTagLock(target, () => dropDecision(target, decision, now, successor))
    return null
  }
  return now.getTime() >= since + decision.debounceMs ? decision : null
}

// Drops a decision undecided after 24 hours, under the tag's lock like every change of its state. A
// check hands its key on to the record successor gives, in the same step, as a decided one does: a
// planned stop that closed meanwhile cannot slip its check in between. When the successor cannot be
// read, the drop waits for its next attempt
async function dropDecision(
  target: DecisionTarget,
  decision: PendingDecision,
  now: Date,
  successor: (dropped: PendingDecision) => Promise<PendingDecision | undefined>,
): Promise<void> {
  let next: PendingDecision | undefined
  try {
    next = await successor(decision)
  } catch (err) {
    await deferDecision(target, decision, now, err)
    return
  }
  if (await replaceIfSameSince(target, decision, next)) {
    logger.error('Run-mode decision dropped undecided after 24 hours; a stop may be lost', {
      event: 'run_mode.decision.abandoned',
      ...logFields(target, decision),
      attempts: decision.attempts,
    })
  }
}

// The decision could not be made, because telemetry could not answer or MongoDB or Redis failed:
// it is made again on the retry schedule. Only the first failure is logged, with its cause, and a
// decision another writer made meanwhile stays made
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
  logger.warn('Run-mode decision deferred to its next attempt', {
    event: 'run_mode.decision.deferred',
    ...logFields(target, decision),
    nextAttemptAt,
    error: error instanceof Error ? error.message : error,
    // Why telemetry could not answer: the HTTP status, the fetch error or the timeout
    ...(error instanceof Error && typeof error.cause === 'string' ? { cause: error.cause } : {}),
  })
}

// The decided record goes, unless another writer has replaced it with a newer one meanwhile. A
// decided check hands its key on to the next one, in the same step
export async function resolveDecision(
  target: DecisionTarget,
  decision: PendingDecision,
  now: Date,
  next?: PendingDecision,
): Promise<void> {
  if (await replaceIfSameSince(target, decision, next)) logDecisionResolved(target, decision, now)
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
