import { request } from './telemetry-request.client.js'

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
