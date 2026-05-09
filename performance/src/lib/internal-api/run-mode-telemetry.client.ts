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

export interface StateDurationsPage {
  segments: StateDurationSegment[]
  hasMore: boolean
  nextCursor: string | null
}

export async function getStateDurations(
  tagId: string,
  from: Date,
  to: Date,
  opts?: { limit?: number; after?: Date },
): Promise<StateDurationsPage> {
  const params = new URLSearchParams()
  params.set('from', from.toISOString())
  params.set('to', to.toISOString())
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts?.after !== undefined) params.set('after', opts.after.toISOString())
  const url = `/internal/v1/historian/${tagId}/state-durations?${params.toString()}`
  const result = await request<StateDurationsPage>(url)
  return result ?? { segments: [], hasMore: false, nextCursor: null }
}
