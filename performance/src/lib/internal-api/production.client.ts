import { getTraceId } from '@mes/core'
import { config } from '../../config/index.js'
import type { JobWindow } from '../../modules/oee/oee.types.js'
import { logger } from '../logger.js'

export interface ProductStandardTimeline {
  _id: string
  validFrom: string
  idealOutputPerMinute: number
  counterMultiplier: number | null
  idealSpeed: number | null
}

export interface TimelinesBatchItem {
  jobOrderId: string
  workCenterId: string
  productId: string
  from: Date
  to: Date
}

export interface QuantityAdjustmentRecord {
  _id: string
  jobOrderId?: string
  workCenterId?: string
  productId?: string
  amount: number
  time: string | Date
  reason?: string | null
}

export interface ScrapEntryRecord {
  _id: string
  jobOrderId?: string
  workCenterId?: string
  productId?: string
  amount: number
  reasonId?: string | null
  startTime?: string | Date
  endTime?: string | Date
}

export interface JobOrderRecordsBatchResult {
  quantityAdjustmentsByJobOrderId: Record<string, QuantityAdjustmentRecord[]>
  scrapEntriesByJobOrderId: Record<string, ScrapEntryRecord[]>
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${config.INTERNAL_API_PRODUCTION}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        'x-trace-id': getTraceId() ?? '',
        'content-type': 'application/json',
        accept: 'application/json',
      },
    })
    if (res.status === 404) return null
    if (!res.ok) {
      logger.warn('Production internal fetch failed', {
        event: 'internal_api.production.fetch_failed',
        status: res.status,
        path,
      })
      return null
    }
    const body = (await res.json()) as { data?: T }
    return body.data ?? null
  } catch (err) {
    logger.warn('Production internal fetch errored', {
      event: 'internal_api.production.fetch_errored',
      path,
      error: err instanceof Error ? err.message : err,
    })
    return null
  }
}

interface RawJobOrder {
  _id: string
  workCenterId: string
  productId: string
  startTime: string | null
  endTime: string | null
  code: string
}

// Returns job orders whose interval overlaps [from, to] AND whose runtimeState is 'running'
// (startTime set, endTime null). Completed orders that overlap the range are excluded.
export async function findStartedJobOrders({
  workCenterId,
  from,
  to,
}: {
  workCenterId: string
  from: Date
  to: Date
}): Promise<JobWindow[]> {
  const params = new URLSearchParams({
    workCenterId,
    activeFrom: from.toISOString(),
    activeTo: to.toISOString(),
    runtimeState: 'running',
    limit: '500',
    page: '1',
  })
  const raw = await request<RawJobOrder[]>(`/internal/v1/job-orders?${params}`)
  if (!raw) return []

  const results: JobWindow[] = []
  for (const jo of raw) {
    if (!jo.startTime) continue
    results.push({
      jobOrderId: jo._id,
      workCenterId: jo.workCenterId,
      productId: jo.productId,
      start: new Date(jo.startTime),
      end: jo.endTime ? new Date(jo.endTime) : to,
    })
  }
  return results
}

interface TimelineResultItem {
  jobOrderId: string
  standards: ProductStandardTimeline[]
  qualityFlags: string[]
}

export async function findProductStandardTimelinesBatch(
  items: TimelinesBatchItem[],
): Promise<Record<string, ProductStandardTimeline[]>> {
  if (items.length === 0) return {}

  const body = {
    items: items.map(i => ({
      jobOrderId: i.jobOrderId,
      workCenterId: i.workCenterId,
      productId: i.productId,
      from: i.from.toISOString(),
      to: i.to.toISOString(),
    })),
  }

  const result = await request<{ items: TimelineResultItem[] }>(
    '/internal/v1/product-standards/timelines:batch',
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!result) return {}

  const map: Record<string, ProductStandardTimeline[]> = {}
  for (const entry of result.items) {
    map[entry.jobOrderId] = entry.standards
  }
  return map
}

export async function findJobOrderRecordsBatch({
  items,
  include,
}: {
  items: Array<{ jobOrderId: string; from: Date; to: Date }>
  include: Array<'quantity_adjustments' | 'scrap_entries'>
}): Promise<JobOrderRecordsBatchResult> {
  const empty: JobOrderRecordsBatchResult = {
    quantityAdjustmentsByJobOrderId: {},
    scrapEntriesByJobOrderId: {},
  }
  if (items.length === 0) return empty

  const body = {
    items: items.map(i => ({
      jobOrderId: i.jobOrderId,
      from: i.from.toISOString(),
      to: i.to.toISOString(),
    })),
    include,
  }

  const result = await request<JobOrderRecordsBatchResult>('/internal/v1/job-order-records:batch', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!result) return empty

  return {
    quantityAdjustmentsByJobOrderId: result.quantityAdjustmentsByJobOrderId ?? {},
    scrapEntriesByJobOrderId: result.scrapEntriesByJobOrderId ?? {},
  }
}
