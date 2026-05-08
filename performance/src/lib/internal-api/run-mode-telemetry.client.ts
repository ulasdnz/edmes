import { request } from './telemetry-request.client.js'

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
