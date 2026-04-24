import { getTraceId } from '@mes/core'
import { config } from '../../config/index.js'
import { logger } from '../logger.js'

export interface LatestSample {
  tagId: string
  value: number
  occurredAt: string
}

export interface StateDurationSegment {
  from: string
  to: string
  value: number
  durationMs: number
}

export interface SummaryWindow {
  from: Date
  to: Date
}

export type ProducedQualityFlag = 'missing_baseline' | 'counter_reset_observed' | 'samples_missing'

export interface ProducedSummaryWindow {
  from: string
  to: string
  value: number
  qualityFlags: ProducedQualityFlag[]
}

export interface ProducedSummary {
  windows: ProducedSummaryWindow[]
  total: number
}

export interface SpeedSummaryWindow {
  from: string
  to: string
  durationMs: number
  timeWeightedAverage: number
  valueArea: number
  sampleCount: number
}

export interface SpeedSummary {
  windows: SpeedSummaryWindow[]
  total: {
    durationMs: number
    timeWeightedAverage: number
    valueArea: number
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${config.INTERNAL_API_TELEMETRY}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        'x-trace-id': getTraceId() ?? '',
        accept: 'application/json',
      },
    })
    if (res.status === 404) return null
    if (!res.ok) {
      logger.warn('Telemetry internal fetch failed', {
        event: 'internal_api.telemetry.fetch_failed',
        path,
        status: res.status,
      })
      return null
    }
    const body = (await res.json()) as { data?: T }
    return body.data ?? null
  } catch (err) {
    logger.warn('Telemetry internal fetch errored', {
      event: 'internal_api.telemetry.fetch_errored',
      path,
      error: err instanceof Error ? err.message : err,
    })
    return null
  }
}

export async function getLatest(tagId: string): Promise<LatestSample | null> {
  return request<LatestSample>(`/internal/v1/historian/${tagId}/latest`)
}

export async function getStateDurations(
  tagId: string,
  from: Date,
  to: Date,
): Promise<StateDurationSegment[]> {
  const url = `/internal/v1/historian/${tagId}/state-durations?from=${encodeURIComponent(
    from.toISOString(),
  )}&to=${encodeURIComponent(to.toISOString())}`
  const result = await request<StateDurationSegment[]>(url)
  return result ?? []
}

/**
 * Fetch produced counts across multiple windows for a counter tag in one round trip.
 *
 * Caller is responsible for sending non-overlapping windows. Overlapping windows are
 * permitted but the `total` will double-count the intersecting regions.
 */
export async function producedSummary(
  tagId: string,
  windows: SummaryWindow[],
): Promise<ProducedSummary | null> {
  return request<ProducedSummary>(`/internal/v1/historian/${tagId}/produced-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      windows: windows.map(w => ({ from: w.from.toISOString(), to: w.to.toISOString() })),
    }),
  })
}

/**
 * Fetch time-weighted speed summaries across multiple windows for a speed tag in one round trip.
 *
 * Caller is responsible for sending non-overlapping windows. Overlapping windows are
 * permitted but the `total.durationMs` / `total.valueArea` will double-count the
 * intersecting regions.
 */
export async function speedSummary(
  tagId: string,
  windows: SummaryWindow[],
): Promise<SpeedSummary | null> {
  return request<SpeedSummary>(`/internal/v1/historian/${tagId}/speed-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      windows: windows.map(w => ({ from: w.from.toISOString(), to: w.to.toISOString() })),
    }),
  })
}
