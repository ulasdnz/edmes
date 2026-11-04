import { setTimeout as pause } from 'node:timers/promises'
import { parseUtcZonedDateTime } from '@mes/core'
import mongoose from 'mongoose'
import { CustomError } from '../../core/errors/index.js'
import { emitTagValueRecorded } from '../../jobs/events.js'
import { getPeriodLock } from '../../jobs/subscribers.js'
import { logger } from '../../lib/logger.js'
import type { ITag } from '../tag/tag.model.js'
import { bindingCacheResolve } from './binding-cache.js'
import { type HistorianSample, insertSample } from './historian.repository.js'
import { predecessorDelete, predecessorLoad, predecessorSet } from './predecessor-cache.js'

interface IncomingMessage {
  time: string
  value: number
}

export type IngestValueResult =
  | { applied: true; reason: 'history_inserted' }
  | {
      applied: false
      reason: 'out_of_order' | 'same_value' | 'within_tolerance' | 'out_of_range'
    }

// `stop` aborts when telemetry stops: a message still waiting for MongoDB is then abandoned
export const processMessage = async (
  topic: string,
  payload: Buffer,
  stop: AbortSignal,
): Promise<void> => {
  const parts = topic.split('/')
  if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'nodes') return

  const deviceKey = parts[1]
  const nodeId = parts[3]

  const wait: MongoWait = { topic, stop, takenAt: Date.now(), failures: 0, abandoned: false }
  // A message that waits for MongoDB keeps its place: the next message for the same node waits behind
  // it, from the tag lookup on
  return runInOrder(nodeQueues, `${deviceKey}:${nodeId}`, () =>
    storeMessage(wait, deviceKey, nodeId, payload).finally(() => logWaitEnded(wait)),
  )
}

const storeMessage = async (
  wait: MongoWait,
  deviceKey: string,
  nodeId: string,
  payload: Buffer,
): Promise<void> => {
  const { topic } = wait

  const tag = await untilMongoAnswers(wait, () => bindingCacheResolve(deviceKey, nodeId))
  if (tag === ABANDONED) return
  if (!tag) {
    logger.debug('MQTT sample dropped: no bound tag found', {
      event: 'ingestion.binding.not_found',
      topic,
      deviceKey,
      nodeId,
    })
    return
  }
  const tagId = tag._id.toString()
  wait.tagId = tagId

  let msg: IncomingMessage
  try {
    msg = JSON.parse(payload.toString())
  } catch {
    return
  }

  const occurredAt = parseUtcZonedDateTime(msg.time)
  if (!occurredAt) return

  // A failed store may have reached MongoDB, so the retry reads the predecessor from MongoDB again
  const result = await runInOrder(tagQueues, tagId, () =>
    untilMongoAnswers(
      wait,
      () => applyValue(tag, msg.value, occurredAt),
      () => predecessorDelete(tagId),
    ),
  )
  if (result === ABANDONED) return

  if (!result.applied && result.reason === 'out_of_order') {
    logger.warn('Out-of-order MQTT telemetry sample dropped', {
      event: 'ingestion.sample.out_of_order',
      topic,
      tagId,
      deviceKey,
      nodeId,
      occurredAt: occurredAt.toISOString(),
    })
  }
}

// Samples for one tag can overlap (MQTT handlers are not awaited, manual entries arrive via HTTP).
// Each sample must see the predecessor written by the previous one, so they run one at a time.
const tagQueues = new Map<string, Promise<void>>()
const nodeQueues = new Map<string, Promise<void>>()

const runInOrder = <T>(
  queues: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> => {
  const result = (queues.get(key) ?? Promise.resolve()).then(task)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return result
}

// A manual entry is not retried: the person entering it sees MongoDB's error
export const ingestValue = (
  tag: ITag,
  rawValue: number,
  occurredAt: Date,
): Promise<IngestValueResult> =>
  runInOrder(tagQueues, tag._id.toString(), () => applyValue(tag, rawValue, occurredAt))

const ABANDONED = Symbol('abandoned')

interface MongoWait {
  topic: string
  stop: AbortSignal
  takenAt: number
  failures: number
  abandoned: boolean
  // The message's tag, once it is looked up
  tagId?: string
}

// A message that waited for MongoDB ends its wait with one line, however it is handled then: stored,
// dropped, or failed for another reason. One abandoned at a stop has its own line
const logWaitEnded = (wait: MongoWait): void => {
  if (wait.failures === 0 || wait.abandoned) return
  logger.info('Message handled after MongoDB came back', {
    event: 'ingestion.store.resolved',
    topic: wait.topic,
    ...(wait.tagId ? { tagId: wait.tagId } : {}),
    waitedMs: Date.now() - wait.takenAt,
    failedAttempts: wait.failures,
  })
}

// The driver found no server or lost its connection: MongoDB is unreachable, and the step succeeds
// once it is back. Any other error belongs to the message. Mongoose buffers no model operation once
// it has connected, and telemetry takes no message in before that
const isMongoUnreachable = (err: unknown): err is Error =>
  err instanceof mongoose.mongo.MongoServerSelectionError ||
  err instanceof mongoose.mongo.MongoNetworkError

const mongoDown = () => mongoose.connection.readyState !== mongoose.ConnectionStates.connected

const retryDelayMs = (failures: number) => Math.min(1000 * 2 ** (failures - 1), 30_000)

// Runs a step of a message's store until MongoDB answers it. Telemetry acknowledged the message, so
// the step waits for MongoDB as long as it takes, and is abandoned only when telemetry stops.
const untilMongoAnswers = async <T>(
  wait: MongoWait,
  step: () => Promise<T>,
  afterFailure?: () => void,
): Promise<T | typeof ABANDONED> => {
  for (;;) {
    if (wait.stop.aborted && mongoDown()) return abandon(wait)
    const outcome = await unlessStopped(step(), wait.stop)
    if (outcome === ABANDONED) return abandon(wait)
    if (!('error' in outcome)) return outcome.value
    if (!isMongoUnreachable(outcome.error)) throw outcome.error

    wait.failures++
    afterFailure?.()
    if (wait.failures === 1) {
      logger.warn('MongoDB unreachable, message waits for it', {
        event: 'ingestion.store.deferred',
        topic: wait.topic,
        error: outcome.error.message,
      })
    }
    if (wait.stop.aborted) return abandon(wait)
    await pause(retryDelayMs(wait.failures), undefined, { signal: wait.stop }).catch(() => {})
  }
}

// When telemetry stops while MongoDB is down, the step stops waiting for an answer that may not come
// before telemetry exits. While MongoDB is up, the step runs to its end, so the message is stored.
const unlessStopped = <T>(attempt: Promise<T>, stop: AbortSignal) =>
  new Promise<{ value: T } | { error: unknown } | typeof ABANDONED>(resolve => {
    const onStop = () => {
      if (mongoDown()) resolve(ABANDONED)
    }
    stop.addEventListener('abort', onStop, { once: true })
    void attempt
      .then(
        value => resolve({ value }),
        error => resolve({ error }),
      )
      .finally(() => stop.removeEventListener('abort', onStop))
  })

const abandon = (wait: MongoWait): typeof ABANDONED => {
  wait.abandoned = true
  logger.error('Telemetry stopped before MongoDB stored a message', {
    event: 'ingestion.store.abandoned',
    topic: wait.topic,
    waitedMs: Date.now() - wait.takenAt,
  })
  return ABANDONED
}

const applyValue = async (
  tag: ITag,
  rawValue: number,
  occurredAt: Date,
): Promise<IngestValueResult> => {
  const tagId = tag._id.toString()

  const lock = getPeriodLock()
  if (lock && occurredAt.getTime() <= lock.getTime()) {
    throw new CustomError(409, 'historian.period_locked')
  }

  const pred = await predecessorLoad(tagId, tag.behavior)

  if (pred && occurredAt.getTime() <= pred.occurredAt.getTime()) {
    return { applied: false, reason: 'out_of_order' }
  }

  let value = rawValue
  if (tag.behavior !== 'binary' && tag.digit != null) {
    const factor = 10 ** tag.digit
    value = Math.round(rawValue * factor) / factor
  }

  if (tag.behavior !== 'binary') {
    if (tag.min != null && value < tag.min) return { applied: false, reason: 'out_of_range' }
    if (tag.max != null && value > tag.max) return { applied: false, reason: 'out_of_range' }
  }

  if (pred && value === pred.value) return { applied: false, reason: 'same_value' }

  if (tag.behavior !== 'binary' && tag.tolerance > 0 && pred) {
    if (Math.abs(value - pred.value) < tag.tolerance) {
      return { applied: false, reason: 'within_tolerance' }
    }
  }

  const sample = buildSample(tag.behavior, value, occurredAt, pred)

  await insertSample(tagId, sample)

  const newPred = {
    value,
    occurredAt,
    prevValue: pred?.value ?? null,
    prevTs: pred?.occurredAt ?? null,
    ...(tag.behavior === 'counter'
      ? {
          prev2Value: pred?.prevValue ?? null,
          prev2Ts: pred?.prevTs ?? null,
        }
      : {}),
  }
  predecessorSet(tagId, newPred)

  await emitTagValueRecorded(tagId, tag.behavior, value, occurredAt, pred?.occurredAt ?? null)
  return { applied: true, reason: 'history_inserted' }
}

function buildSample(
  behavior: string,
  value: number,
  occurredAt: Date,
  pred:
    | {
        value: number
        occurredAt: Date
        prevValue: number | null
        prevTs: Date | null
        prev2Value?: number | null
        prev2Ts?: Date | null
      }
    | undefined,
): HistorianSample {
  const prevValue = pred?.value ?? null
  const prevTs = pred?.occurredAt ?? null

  if (behavior === 'counter') {
    const prev2Value = pred?.prevValue ?? null
    const prev2Ts = pred?.prevTs ?? null

    let reset = false
    if (prev2Value != null && prevValue != null) {
      reset =
        (prev2Value > value && value > prevValue) || (prev2Value > prevValue && prevValue > value)
    }

    return { occurredAt, value, prevValue, prevTs, prev2Value, prev2Ts, reset }
  }

  return { occurredAt, value, prevValue, prevTs }
}
