import type { JobWindow, NormalizedStop } from './oee.types.js'

export type AvailabilityStatus = 'ok' | 'no_context' | 'not_calculable'

export type AvailabilityResult = {
  status: AvailabilityStatus
  ratio: number
  jobOrderTimeMs: number
  oeeEligibleTimeMs: number
  effectiveRunTimeMs: number
  oeeAffectingStopMs: number
  nonEffectiveStopMs: number
}

export type AvailabilityInput = {
  clippedJobWindows: JobWindow[]
  calculationStops: NormalizedStop[]
}

export function calculateAvailability(input: AvailabilityInput): AvailabilityResult {
  const { clippedJobWindows, calculationStops } = input

  let jobOrderTimeMs = 0
  for (const jw of clippedJobWindows) {
    jobOrderTimeMs += jw.end.getTime() - jw.start.getTime()
  }

  if (jobOrderTimeMs === 0) {
    return {
      status: 'no_context',
      ratio: 0,
      jobOrderTimeMs: 0,
      oeeEligibleTimeMs: 0,
      effectiveRunTimeMs: 0,
      oeeAffectingStopMs: 0,
      nonEffectiveStopMs: 0,
    }
  }

  const sortedWindows = [...clippedJobWindows].sort((a, b) => a.start.getTime() - b.start.getTime())

  let oeeAffectingStopMs = 0
  let nonEffectiveStopMs = 0

  for (const stop of calculationStops) {
    const stopMs = intersectionMs(stop.start, stop.end, sortedWindows)
    if (stopMs === 0) continue
    if (stop.effectiveAffectsOee) oeeAffectingStopMs += stopMs
    else nonEffectiveStopMs += stopMs
  }

  const effectiveRunTimeMs = jobOrderTimeMs - (oeeAffectingStopMs + nonEffectiveStopMs)
  const oeeEligibleTimeMs = jobOrderTimeMs - nonEffectiveStopMs
  const ratio = oeeEligibleTimeMs > 0 ? effectiveRunTimeMs / oeeEligibleTimeMs : 0

  return {
    status: 'ok',
    ratio,
    jobOrderTimeMs,
    oeeEligibleTimeMs,
    effectiveRunTimeMs,
    oeeAffectingStopMs,
    nonEffectiveStopMs,
  }
}

function intersectionMs(sStart: Date, sEnd: Date, windows: JobWindow[]): number {
  const s = sStart.getTime()
  const e = sEnd.getTime()
  let total = 0
  for (const w of windows) {
    const ws = w.start.getTime()
    const we = w.end.getTime()
    if (ws >= e) break
    if (we <= s) continue
    total += Math.min(e, we) - Math.max(s, ws)
  }
  return total
}
