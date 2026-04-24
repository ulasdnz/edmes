import { clip, mergeIntervals, subtractIntervals, subtractOne } from '../../utils/intervals.js'
import { type Diagnostic, diag } from './diagnostics.js'
import type { JobWindow, NormalizedStop, OeeRange, StopInterval } from './oee.types.js'

export type NormalizeInput = {
  range: OeeRange
  jobOrderWindows: JobWindow[]
  planned: StopInterval[]
  unplanned: StopInterval[]
  nonOeeReasonIds: Set<string>
  microStopReasonId: string
}

export type NormalizeOutput = {
  clippedJobWindows: JobWindow[]
  calculationStops: NormalizedStop[]
  productionRunWindows: OeeRange[]
  diagnostics: Diagnostic[]
}

export function normalize(input: NormalizeInput): NormalizeOutput {
  const { range, jobOrderWindows, planned, unplanned, nonOeeReasonIds, microStopReasonId } = input
  const diagnostics: Diagnostic[] = []

  const clippedJobWindows: JobWindow[] = []
  for (const jw of jobOrderWindows) {
    const c = clip({ start: jw.start, end: jw.end }, { start: range.from, end: range.to })
    if (!c) continue
    clippedJobWindows.push({ ...jw, start: c.start, end: c.end })
  }
  clippedJobWindows.sort((a, b) => a.start.getTime() - b.start.getTime())
  if (clippedJobWindows.length === 0) {
    diagnostics.push(diag('no_job_order_in_range', 'info'))
  }

  const plannedPieces: StopInterval[] = []
  for (const p of planned) {
    const c = clip({ start: p.start, end: p.end }, { start: range.from, end: range.to })
    if (!c) continue
    plannedPieces.push({ ...p, start: c.start, end: c.end })
  }
  plannedPieces.sort((a, b) => a.start.getTime() - b.start.getTime())

  const unplannedPieces: StopInterval[] = []
  for (const u of unplanned) {
    if (u.reasonId === microStopReasonId) continue
    const c = clip({ start: u.start, end: u.end }, { start: range.from, end: range.to })
    if (!c) continue
    unplannedPieces.push({ ...u, start: c.start, end: c.end })
  }
  unplannedPieces.sort((a, b) => a.start.getTime() - b.start.getTime())

  const plannedMerged = mergeIntervals(plannedPieces.map(p => ({ start: p.start, end: p.end })))

  const plannedById = new Map<string, StopInterval>()
  for (const p of plannedPieces) plannedById.set(p._id, p)

  const emittedUnplanned: StopInterval[] = []
  let regularClipped = false
  for (const u of unplannedPieces) {
    let resolvedReasonId: string | null = u.reasonId
    let isConverted = false
    if (u.linkedPlannedStopId) {
      const linked = plannedById.get(u.linkedPlannedStopId)
      if (linked) {
        isConverted = true
        resolvedReasonId = linked.reasonId
      } else {
        diagnostics.push(
          diag('converted_unplanned_missing_link', 'warning', {
            unplannedId: u._id,
            linkedPlannedStopId: u.linkedPlannedStopId,
          }),
        )
      }
    }

    const remainder = subtractOne({ start: u.start, end: u.end }, plannedMerged)
    const originalMs = u.end.getTime() - u.start.getTime()
    const remainderMs = remainder.reduce((acc, r) => acc + (r.end.getTime() - r.start.getTime()), 0)
    if (!isConverted && remainderMs < originalMs) {
      regularClipped = true
    }
    for (const piece of remainder) {
      emittedUnplanned.push({
        ...u,
        reasonId: resolvedReasonId,
        start: piece.start,
        end: piece.end,
      })
    }
  }
  if (regularClipped) {
    diagnostics.push(diag('overlapping_stop_records_clipped', 'warning'))
  }

  const resolveEffective = (reasonId: string | null): boolean => {
    if (reasonId == null) return true
    return !nonOeeReasonIds.has(reasonId)
  }

  const calculationStops: NormalizedStop[] = []
  for (const p of plannedPieces) {
    calculationStops.push({
      ...p,
      effectiveAffectsOee: resolveEffective(p.reasonId),
      isMicroStop: false,
    })
  }
  for (const u of emittedUnplanned) {
    calculationStops.push({
      ...u,
      effectiveAffectsOee: resolveEffective(u.reasonId),
      isMicroStop: false,
    })
  }
  calculationStops.sort((a, b) => a.start.getTime() - b.start.getTime())

  const allStopsMerged = mergeIntervals(calculationStops.map(s => ({ start: s.start, end: s.end })))
  const subtracted = subtractIntervals(
    clippedJobWindows.map(w => ({ start: w.start, end: w.end })),
    allStopsMerged,
  )
  const productionRunWindows: OeeRange[] = subtracted.map(p => ({ from: p.start, to: p.end }))

  return {
    clippedJobWindows,
    calculationStops,
    productionRunWindows,
    diagnostics,
  }
}
