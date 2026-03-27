import { getTraceId } from '@mes/core'
import { publishEvent } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const STREAM = 'events.production'

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

// ── Uom events ──────────────────────────────────────────────────────────────

export const emitUomCreated = (uomId: string) => emit('uom.created', { uomId })
export const emitUomUpdated = (uomId: string) => emit('uom.updated', { uomId })
export const emitUomDeleted = (uomId: string) => emit('uom.deleted', { uomId })

// ── ProductCategory events ──────────────────────────────────────────────────

export const emitProductCategoryCreated = (categoryId: string) =>
  emit('product_category.created', { categoryId })
export const emitProductCategoryUpdated = (categoryId: string) =>
  emit('product_category.updated', { categoryId })
export const emitProductCategoryDeleted = (categoryId: string) =>
  emit('product_category.deleted', { categoryId })

// ── Product events ──────────────────────────────────────────────────────────

export const emitProductCreated = (productId: string) => emit('product.created', { productId })
export const emitProductUpdated = (productId: string) => emit('product.updated', { productId })
export const emitProductDeleted = (productId: string) => emit('product.deleted', { productId })

// ── ProductStandard events ──────────────────────────────────────────────────

export const emitProductStandardCreated = (standardId: string) =>
  emit('product_standard.created', { standardId })
export const emitProductStandardUpdated = (standardId: string) =>
  emit('product_standard.updated', { standardId })
export const emitProductStandardDeleted = (standardId: string) =>
  emit('product_standard.deleted', { standardId })

// ── ProductionPlan events ───────────────────────────────────────────────────

export const emitProductionPlanCreated = (planId: string) =>
  emit('production_plan.created', { planId })
export const emitProductionPlanUpdated = (planId: string) =>
  emit('production_plan.updated', { planId })
export const emitProductionPlanDeleted = (planId: string) =>
  emit('production_plan.deleted', { planId })

// ── JobOrder events ─────────────────────────────────────────────────────────

export const emitJobOrderCreated = (jobOrderId: string, workCenterId: string) =>
  emit('job_order.created', { jobOrderId, workCenterId })
export const emitJobOrderUpdated = (
  jobOrderId: string,
  workCenterId: string,
  previousWorkCenterId?: string,
) => emit('job_order.updated', { jobOrderId, workCenterId, previousWorkCenterId })
export const emitJobOrderStarted = (jobOrderId: string, workCenterId: string) =>
  emit('job_order.started', { jobOrderId, workCenterId })
export const emitJobOrderEnded = (jobOrderId: string, workCenterId: string) =>
  emit('job_order.ended', { jobOrderId, workCenterId })
export const emitJobOrderDeleted = (jobOrderId: string, workCenterId: string) =>
  emit('job_order.deleted', { jobOrderId, workCenterId })

// ── QuantityAdjustment events ───────────────────────────────────────────────

export const emitQuantityAdjustmentCreated = (
  adjustmentId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('quantity_adjustment.created', { adjustmentId, jobOrderId, workCenterId })
export const emitQuantityAdjustmentUpdated = (
  adjustmentId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('quantity_adjustment.updated', { adjustmentId, jobOrderId, workCenterId })
export const emitQuantityAdjustmentDeleted = (
  adjustmentId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('quantity_adjustment.deleted', { adjustmentId, jobOrderId, workCenterId })

// ── ScrapEntry events ───────────────────────────────────────────────────────

export const emitScrapEntryCreated = (
  scrapEntryId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('scrap_entry.created', { scrapEntryId, jobOrderId, workCenterId })
export const emitScrapEntryUpdated = (
  scrapEntryId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('scrap_entry.updated', { scrapEntryId, jobOrderId, workCenterId })
export const emitScrapEntryDeleted = (
  scrapEntryId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('scrap_entry.deleted', { scrapEntryId, jobOrderId, workCenterId })
