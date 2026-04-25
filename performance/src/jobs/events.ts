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

export const emitPlannedStopTemplateCreated = (templateId: string, workCenterIds: string[]) =>
  emit('planned_stop_template.created', { templateId, workCenterIds })
export const emitPlannedStopTemplateUpdated = (templateId: string, workCenterIds: string[]) =>
  emit('planned_stop_template.updated', { templateId, workCenterIds })
export const emitPlannedStopTemplateDeleted = (templateId: string, workCenterIds: string[]) =>
  emit('planned_stop_template.deleted', { templateId, workCenterIds })
export const emitPlannedStopTemplateStarted = (
  templateId: string,
  workCenterIds: string[],
  plannedStopId: string,
) => emit('planned_stop_template.started', { templateId, workCenterIds, plannedStopId })

export const emitPlannedStopScheduleCreated = (scheduleId: string, workCenterIds: string[]) =>
  emit('planned_stop_schedule.created', { scheduleId, workCenterIds })
export const emitPlannedStopScheduleUpdated = (scheduleId: string, workCenterIds: string[]) =>
  emit('planned_stop_schedule.updated', { scheduleId, workCenterIds })
export const emitPlannedStopScheduleDeleted = (scheduleId: string, workCenterIds: string[]) =>
  emit('planned_stop_schedule.deleted', { scheduleId, workCenterIds })

export const emitUnplannedStopOpened = (unplannedStopId: string, workCenterId: string) =>
  emit('unplanned_stop.opened', { unplannedStopId, workCenterId })
export const emitUnplannedStopUpdated = (unplannedStopId: string, workCenterId: string) =>
  emit('unplanned_stop.updated', { unplannedStopId, workCenterId })
export const emitUnplannedStopClosed = (unplannedStopId: string, workCenterId: string) =>
  emit('unplanned_stop.closed', { unplannedStopId, workCenterId })
export const emitUnplannedStopConverted = (
  unplannedStopId: string,
  workCenterId: string,
  convertedToPlannedStopId?: string,
) =>
  emit('unplanned_stop.converted', {
    unplannedStopId,
    workCenterId,
    ...(convertedToPlannedStopId ? { convertedToPlannedStopId } : {}),
  })
