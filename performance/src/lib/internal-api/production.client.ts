import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { CustomError, getTraceId } from '@mes/core'
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
  reasonId: string | null
  startTime: string | Date
  endTime: string | Date
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
        [INTERNAL_TOKEN_HEADER]: config.INTERNAL_API_TOKEN,
        'content-type': 'application/json',
        accept: 'application/json',
      },
    })
    if (res.status === 404) return null
    // A failed answer is not an empty one; read as empty it would make the OEE wrong
    if (!res.ok) {
      logger.warn('Production internal fetch failed', {
        event: 'internal_api.production.fetch_failed',
        status: res.status,
        path,
      })
      throw new CustomError(503, 'error.production_unreachable')
    }
    const body = (await res.json()) as { data?: T }
    return body.data ?? null
  } catch (err) {
    if (err instanceof CustomError) throw err
    logger.warn('Production internal fetch errored', {
      event: 'internal_api.production.fetch_errored',
      path,
      error: err instanceof Error ? err.message : err,
    })
    throw new CustomError(503, 'error.production_unreachable')
  }
}

interface RawJobOrderWindow {
  _id: string
  workCenterId: string
  productId: string
  startTime: string
  endTime: string | null
}

// Returns every started job order whose interval overlaps [from, to), oldest first. A running
// job order ends at `to`.
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
    from: from.toISOString(),
    to: to.toISOString(),
  })
  const raw = await request<RawJobOrderWindow[]>(`/internal/v1/job-order-windows?${params}`)
  if (!raw) return []

  return raw.map(jo => ({
    jobOrderId: jo._id,
    workCenterId: jo.workCenterId,
    productId: jo.productId,
    start: new Date(jo.startTime),
    end: jo.endTime ? new Date(jo.endTime) : to,
  }))
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
