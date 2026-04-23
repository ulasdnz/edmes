import { getTraceId } from '@mes/core'
import { publishEvent } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const STREAM = 'events.performance'

export async function emit(type: string, data: Record<string, unknown>): Promise<void> {
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

export const emitReasonCreated = (reasonId: string) => emit('reason.created', { reasonId })
export const emitReasonUpdated = (reasonId: string) => emit('reason.updated', { reasonId })
export const emitReasonDeleted = (reasonId: string) => emit('reason.deleted', { reasonId })

export const emitPolicyUpdated = (workCenterId: string | null) =>
  emit('policy.updated', { workCenterId })

export const emitPlannedStopCreated = (plannedStopId: string, workCenterId: string) =>
  emit('planned_stop.created', { plannedStopId, workCenterId })
export const emitPlannedStopUpdated = (plannedStopId: string, workCenterId: string) =>
  emit('planned_stop.updated', { plannedStopId, workCenterId })
export const emitPlannedStopStarted = (plannedStopId: string, workCenterId: string) =>
  emit('planned_stop.started', { plannedStopId, workCenterId })
export const emitPlannedStopClosed = (plannedStopId: string, workCenterId: string) =>
  emit('planned_stop.closed', { plannedStopId, workCenterId })
export const emitPlannedStopCancelled = (plannedStopId: string, workCenterId: string) =>
  emit('planned_stop.cancelled', { plannedStopId, workCenterId })
export const emitPlannedStopDeleted = (plannedStopId: string, workCenterId: string) =>
  emit('planned_stop.deleted', { plannedStopId, workCenterId })

export const emitPlannedStopTemplateCreated = (templateId: string) =>
  emit('planned_stop_template.created', { templateId })
export const emitPlannedStopTemplateUpdated = (templateId: string) =>
  emit('planned_stop_template.updated', { templateId })
export const emitPlannedStopTemplateDeleted = (templateId: string) =>
  emit('planned_stop_template.deleted', { templateId })

export const emitPlannedStopScheduleCreated = (scheduleId: string) =>
  emit('planned_stop_schedule.created', { scheduleId })
export const emitPlannedStopScheduleUpdated = (scheduleId: string) =>
  emit('planned_stop_schedule.updated', { scheduleId })
export const emitPlannedStopScheduleDeleted = (scheduleId: string) =>
  emit('planned_stop_schedule.deleted', { scheduleId })

export const emitUnplannedStopCreated = (unplannedStopId: string, workCenterId: string) =>
  emit('unplanned_stop.created', { unplannedStopId, workCenterId })
export const emitUnplannedStopUpdated = (unplannedStopId: string, workCenterId: string) =>
  emit('unplanned_stop.updated', { unplannedStopId, workCenterId })
export const emitUnplannedStopClosed = (unplannedStopId: string, workCenterId: string) =>
  emit('unplanned_stop.closed', { unplannedStopId, workCenterId })
export const emitUnplannedStopConverted = (unplannedStopId: string, workCenterId: string) =>
  emit('unplanned_stop.converted', { unplannedStopId, workCenterId })
