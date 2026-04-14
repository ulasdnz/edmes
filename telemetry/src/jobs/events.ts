import { getTraceId } from '@mes/core'
import { publishEvent } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const STREAM = 'events.telemetry'

async function emit(type: string, data: Record<string, unknown>): Promise<void> {
  try {
    await publishEvent(streamClient, STREAM, type, { ...data, traceId: getTraceId() })
  } catch (err) {
    logger.warn(`Failed to publish event ${type}`, {
      event: 'events.publish.failed',
      eventType: type,
      error: err instanceof Error ? err.message : err,
    })
  }
}

// ── Tag events ──────────────────────────────────────────────────────────────

export const emitTagCreated = (tagId: string) => emit('tag.created', { tagId })

export const emitTagUpdated = (tagId: string) => emit('tag.updated', { tagId })

export const emitTagDeleted = (tagId: string) => emit('tag.deleted', { tagId })

// ── TagType events ──────────────────────────────────────────────────────────

export const emitTagTypeCreated = (tagTypeId: string) => emit('tag_type.created', { tagTypeId })

export const emitTagTypeUpdated = (tagTypeId: string) => emit('tag_type.updated', { tagTypeId })

export const emitTagTypeDeleted = (tagTypeId: string) => emit('tag_type.deleted', { tagTypeId })

// ── EdgeDevice events ───────────────────────────────────────────────────────

export const emitEdgeDeviceCreated = (edgeDeviceId: string) =>
  emit('edge_device.created', { edgeDeviceId })

export const emitEdgeDeviceUpdated = (edgeDeviceId: string) =>
  emit('edge_device.updated', { edgeDeviceId })

export const emitEdgeDeviceDeleted = (edgeDeviceId: string) =>
  emit('edge_device.deleted', { edgeDeviceId })

// Realtime telemetry events

export const emitTagValueRecorded = (
  tagId: string,
  behavior: string,
  value: number,
  occurredAt: Date,
) =>
  emit('tag.value.recorded', {
    tagId,
    behavior,
    value,
    occurredAt: occurredAt.toISOString(),
  })
