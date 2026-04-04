import { parseUtcZonedDateTime } from '@mes/core'
import { CustomError } from '../../core/errors/index.js'
import { getPeriodLock } from '../../jobs/subscribers.js'
import { logger } from '../../lib/logger.js'
import { pubClient } from '../../lib/redis.js'
import type { ITag } from '../tag/tag.model.js'
import { bindingCacheGet } from './binding-cache.js'
import { upsertCurrentState } from './current-state.repository.js'
import { type HistorianSample, insertSample } from './historian.repository.js'
import { predecessorLoad, predecessorSet } from './predecessor-cache.js'

interface IncomingMessage {
  time: string
  value: number
}

export type IngestValueResult =
  | { applied: true; reason: 'history_inserted' | 'state_updated' }
  | {
      applied: false
      reason: 'out_of_order' | 'same_value' | 'within_tolerance'
    }

export const processMessage = async (topic: string, payload: Buffer): Promise<void> => {
  const parts = topic.split('/')
  if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'nodes') return

  const deviceKey = parts[1]
  const nodeId = parts[3]

  const tag = bindingCacheGet(deviceKey, nodeId)
  if (!tag) return

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

export const ingestValue = async (
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

  if (pred && value === pred.value) return { applied: false, reason: 'same_value' }

  if (tag.behavior !== 'binary' && tag.tolerance > 0 && pred) {
    if (Math.abs(value - pred.value) < tag.tolerance) {
      return { applied: false, reason: 'within_tolerance' }
    }
  }

  if (tag.storageMode === 'stateOnly') {
    await upsertCurrentState(tagId, value, occurredAt)
    await publishRealtimeValue(tagId, value, occurredAt)
    predecessorSet(tagId, {
      value,
      occurredAt,
      prevValue: pred?.value ?? null,
      prevTs: pred?.occurredAt ?? null,
    })
    return { applied: true, reason: 'state_updated' }
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

  await publishRealtimeValue(tagId, value, occurredAt)
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

async function publishRealtimeValue(tagId: string, value: number, occurredAt: Date): Promise<void> {
  try {
    await pubClient.publish(`tag:${tagId}:value`, JSON.stringify({ tagId, value, occurredAt }))
  } catch {
    logger.debug('Redis pub/sub publish failed', { event: 'ingestion.pubsub.failed', tagId })
  }
}
