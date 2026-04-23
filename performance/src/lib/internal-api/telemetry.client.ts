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
