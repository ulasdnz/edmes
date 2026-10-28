import { parseUtcZonedDateTime } from '@mes/core'
import { CustomError } from '../../core/errors/index.js'
import { emitTagValueRecorded } from '../../jobs/events.js'
import { getPeriodLock } from '../../jobs/subscribers.js'
import { logger } from '../../lib/logger.js'
import type { ITag } from '../tag/tag.model.js'
import { bindingCacheResolve } from './binding-cache.js'
import { type HistorianSample, insertSample } from './historian.repository.js'
import { predecessorLoad, predecessorSet } from './predecessor-cache.js'

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

export const processMessage = async (topic: string, payload: Buffer): Promise<void> => {
  const parts = topic.split('/')
  if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'nodes') return

  const deviceKey = parts[1]
  const nodeId = parts[3]

  const tag = await bindingCacheResolve(deviceKey, nodeId)
  if (!tag) {
    logger.debug('MQTT sample dropped: no bound tag found', {
      event: 'ingestion.binding.not_found',
      topic,
      deviceKey,
      nodeId,
    })
    return
  }

  let msg: IncomingMessage
  try {
    msg = JSON.parse(payload.toString())
  } catch {
    return
  }

  const occurredAt = parseUtcZonedDateTime(msg.time)
  if (!occurredAt) return

  const result = await ingestValue(tag, msg.value, occurredAt)
  if (!result.applied && result.reason === 'out_of_order') {
    logger.warn('Out-of-order MQTT telemetry sample dropped', {
      event: 'ingestion.sample.out_of_order',
      topic,
      tagId: tag._id.toString(),
      deviceKey,
      nodeId,
      occurredAt: occurredAt.toISOString(),
    })
  }
}

// Samples for one tag can overlap (MQTT handlers are not awaited, manual entries arrive via HTTP).
// Each sample must see the predecessor written by the previous one, so they run one at a time.
const tagQueues = new Map<string, Promise<void>>()

const runInTagOrder = <T>(tagId: string, task: () => Promise<T>): Promise<T> => {
  const result = (tagQueues.get(tagId) ?? Promise.resolve()).then(task)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  tagQueues.set(tagId, tail)
  void tail.then(() => {
    if (tagQueues.get(tagId) === tail) tagQueues.delete(tagId)
  })
  return result
}

export const ingestValue = (
  tag: ITag,
  rawValue: number,
  occurredAt: Date,
): Promise<IngestValueResult> =>
  runInTagOrder(tag._id.toString(), () => applyValue(tag, rawValue, occurredAt))

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

  await emitTagValueRecorded(tagId, tag.behavior, value, occurredAt)
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
