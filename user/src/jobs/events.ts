import { getTraceId } from '@mes/core'
import { publishEvent } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const STREAM = 'events.user'

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

// ── User events ─────────────────────────────────────────────────────────────

export const emitUserCreated = (userId: string) => emit('user.created', { userId })

export const emitUserUpdated = (userId: string) => emit('user.updated', { userId })

export const emitUserDeleted = (userId: string) => emit('user.deleted', { userId })

// ── Role events ─────────────────────────────────────────────────────────────

export const emitRoleCreated = (roleId: string) => emit('role.created', { roleId })

export const emitRoleUpdated = (roleId: string) => emit('role.updated', { roleId })

export const emitRoleDeleted = (roleId: string) => emit('role.deleted', { roleId })

// ── Speciality events ───────────────────────────────────────────────────────

export const emitSpecialityCreated = (specialityId: string) =>
  emit('speciality.created', { specialityId })

export const emitSpecialityUpdated = (specialityId: string) =>
  emit('speciality.updated', { specialityId })

export const emitSpecialityDeleted = (specialityId: string) =>
  emit('speciality.deleted', { specialityId })
