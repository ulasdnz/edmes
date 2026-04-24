import { type Diagnostic, diag } from './diagnostics.js'

export type QualityStatus = 'ok' | 'no_context'

export type QualityResult = {
  status: QualityStatus
  ratio: number
  good: number
  total: number
  oeeAffectingScrap: number
  excludedScrap: number
  totalScrap: number
  diagnostics: Diagnostic[]
}

export type QualityInput = {
  grossProducedAcrossExecution: number
  quantityAdjustmentSum: number
  scrapEntriesByJobOrder: Array<{
    clippedJobOrderWindow: { start: Date; end: Date }
    entries: Array<{ amount: number; reasonId: string | null; startTime: Date; endTime: Date }>
  }>
  nonOeeReasonIds: Set<string>
  knownReasonIds: Set<string>
}

export function calculateQuality(input: QualityInput): QualityResult {
  const {
    grossProducedAcrossExecution,
    quantityAdjustmentSum,
    scrapEntriesByJobOrder,
    nonOeeReasonIds,
    knownReasonIds,
  } = input

  const total = grossProducedAcrossExecution + quantityAdjustmentSum
  const diagnostics: Diagnostic[] = []

  if (total <= 0) {
    diagnostics.push(diag('no_production_total', 'warning'))
    return {
      status: 'no_context',
      ratio: 0,
      good: 0,
      total,
      oeeAffectingScrap: 0,
      excludedScrap: 0,
      totalScrap: 0,
      diagnostics,
    }
  }

  let oeeAffectingScrap = 0
  let excludedScrap = 0
  const warnedUnknownIds = new Set<string>()

  for (const joGroup of scrapEntriesByJobOrder) {
    const win = joGroup.clippedJobOrderWindow
    const winStart = win.start.getTime()
    const winEnd = win.end.getTime()

    for (const entry of joGroup.entries) {
      const entryStart = entry.startTime.getTime()
      const entryEnd = entry.endTime.getTime()
      const entryDurationMs = entryEnd - entryStart

      const overlapMs = Math.max(0, Math.min(entryEnd, winEnd) - Math.max(entryStart, winStart))
      if (overlapMs <= 0) continue

      const effective = entry.amount * (overlapMs / entryDurationMs)

      if (entry.reasonId === null) {
        oeeAffectingScrap += effective
      } else if (!knownReasonIds.has(entry.reasonId)) {
        oeeAffectingScrap += effective
        if (!warnedUnknownIds.has(entry.reasonId)) {
          warnedUnknownIds.add(entry.reasonId)
          diagnostics.push(
            diag('unknown_scrap_reason_treated_as_oee_affecting', 'warning', {
              reasonId: entry.reasonId,
            }),
          )
        }
      } else if (nonOeeReasonIds.has(entry.reasonId)) {
        excludedScrap += effective
      } else {
        oeeAffectingScrap += effective
      }
    }
  }

  if (oeeAffectingScrap > total) {
    diagnostics.push(diag('scrap_exceeds_total', 'warning', { oeeAffectingScrap, total }))
  }

  const good = Math.max(total - oeeAffectingScrap, 0)
  const ratio = good / total
  const totalScrap = oeeAffectingScrap + excludedScrap

  return {
    status: 'ok',
    ratio,
    good,
    total,
    oeeAffectingScrap,
    excludedScrap,
    totalScrap,
    diagnostics,
  }
}
