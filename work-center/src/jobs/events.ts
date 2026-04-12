import { getTraceId } from '@mes/core'
import { publishEvent } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const STREAM = 'events.work_center'

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

// ── WorkCenter lifecycle events ──────────────────────────────────────────────

export const emitWorkCenterCreated = (workCenterId: string) =>
  emit('work_center.created', { workCenterId })

export const emitWorkCenterUpdated = (workCenterId: string) =>
  emit('work_center.updated', { workCenterId })

export const emitWorkCenterArchived = (workCenterId: string) =>
  emit('work_center.archived', { workCenterId })

export const emitWorkCenterReactivated = (workCenterId: string) =>
  emit('work_center.reactivated', { workCenterId })

export const emitWorkCenterDeleted = (workCenterId: string) =>
  emit('work_center.deleted', { workCenterId })

// ── Hierarchy events ─────────────────────────────────────────────────────────

export const emitHierarchyChanged = (
  workCenterId: string,
  oldParentId: string | null,
  newParentId: string | null,
) => emit('work_center.hierarchy.changed', { workCenterId, oldParentId, newParentId })

// ── Metric composition events ────────────────────────────────────────────────

export const emitMetricCompositionChanged = (workCenterId: string) =>
  emit('work_center.metric_composition.changed', { workCenterId })

// ── Schedule events ──────────────────────────────────────────────────────────

export const emitScheduleChanged = (workCenterId: string) =>
  emit('work_center.schedule.changed', { workCenterId })

// ── Operator events ──────────────────────────────────────────────────────────

export const emitOperatorCheckedIn = (
  workCenterId: string,
  operatorId: string,
  checkInId: string,
) => emit('work_center.operator.checked_in', { workCenterId, operatorId, checkInId })

export const emitOperatorCheckedOut = (
  workCenterId: string,
  operatorId: string,
  checkInId: string,
  checkoutSource: 'manual' | 'shift_boundary',
) =>
  emit('work_center.operator.checked_out', { workCenterId, operatorId, checkInId, checkoutSource })

// ── Action state events ──────────────────────────────────────────────────────

export const emitActionStateChanged = (workCenterId: string) =>
  emit('work_center.action_state.changed', { workCenterId })

// ── Shift lifecycle events ───────────────────────────────────────────────────

export const emitShiftCreated = (shiftId: string) => emit('work_center.shift.created', { shiftId })

export const emitShiftUpdated = (shiftId: string) => emit('work_center.shift.updated', { shiftId })

export const emitShiftDeleted = (shiftId: string) => emit('work_center.shift.deleted', { shiftId })

// ── Shift boundary events ────────────────────────────────────────────────────

export const emitShiftStarted = (payload: {
  shiftId: string
  name: string
  startedAt: Date
  occurrenceDay: string
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}) => emit('work_center.shift.started', { ...payload, startedAt: payload.startedAt.toISOString() })

export const emitShiftEnded = (payload: {
  shiftId: string
  name: string
  startedAt: Date
  endedAt: Date
  occurrenceDay: string
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}) =>
  emit('work_center.shift.ended', {
    ...payload,
    startedAt: payload.startedAt.toISOString(),
    endedAt: payload.endedAt.toISOString(),
  })
