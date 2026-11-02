import { request } from './telemetry-request.client.js'

// The run-mode decisions and the stream consumer wait on these requests, so a telemetry that
// accepts the connection and never answers counts as unreachable after this long, instead of
// after undici's 300 s default
const REQUEST_TIMEOUT_MS = 5000

export interface LatestSample {
  tagId: string
  value: number
  occurredAt: string
}

export interface StateDurationSegment {
  state: number
  start: string
  end: string
  durationMs: number
}

export async function getLatest(tagId: string): Promise<LatestSample | null> {
  return request<LatestSample>(`/internal/v1/historian/${tagId}/latest`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

export interface StateDurationsPage {
  segments: StateDurationSegment[]
  hasMore: boolean
  nextCursor: string | null
}

// null when telemetry does not know the tag
export async function getStateDurations(
  tagId: string,
  from: Date,
  to: Date,
  opts?: { limit?: number; after?: Date },
): Promise<StateDurationsPage | null> {
  const params = new URLSearchParams()
  params.set('from', from.toISOString())
  params.set('to', to.toISOString())
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts?.after !== undefined) params.set('after', opts.after.toISOString())
  const url = `/internal/v1/historian/${tagId}/state-durations?${params.toString()}`
  return request<StateDurationsPage>(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}
