import { describe, expect, it } from 'vitest'
import { calculateQuality } from './quality.calc.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const OEE_REASON = 'reason-oee-affecting'
const NON_OEE_REASON = 'reason-non-oee'
const UNKNOWN_REASON = 'reason-unknown-id'

const WIN_START = new Date('2026-01-01T06:00:00.000Z')
const WIN_END = new Date('2026-01-01T18:00:00.000Z')

function entry(
  amount: number,
  reasonId: string | null,
  startTime = new Date('2026-01-01T08:00:00.000Z'),
  endTime = new Date('2026-01-01T10:00:00.000Z'),
) {
  return { amount, reasonId, startTime, endTime }
}

function joGroup(entries: ReturnType<typeof entry>[], winStart = WIN_START, winEnd = WIN_END) {
  return {
    clippedJobOrderWindow: { start: winStart, end: winEnd },
    entries,
  }
}

const KNOWN_REASON_IDS = new Set([OEE_REASON, NON_OEE_REASON])
const NON_OEE_REASON_IDS = new Set([NON_OEE_REASON])

// ── Arithmetic tests (no prorating boundary cases) ────────────────────────────

describe('calculateQuality — arithmetic', () => {
  it('baseline: 100 produced, 0 adj, 10 scrap OEE-affecting → quality=0.9', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [joGroup([entry(10, OEE_REASON)])],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.status).toBe('ok')
    expect(result.total).toBe(100)
    expect(result.good).toBe(90)
    expect(result.ratio).toBeCloseTo(0.9)
    expect(result.oeeAffectingScrap).toBe(10)
    expect(result.diagnostics).toHaveLength(0)
  })

  it('100 + 20 adj, 30 scrap OEE-affecting → total=120, good=90, quality=0.75', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 20,
      scrapEntriesByJobOrder: [joGroup([entry(30, OEE_REASON)])],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.total).toBe(120)
    expect(result.good).toBe(90)
    expect(result.ratio).toBeCloseTo(0.75)
  })

  it('100 produced, 10 scrap with affectsOee=false → excludedScrap=10, quality=1.0', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [joGroup([entry(10, NON_OEE_REASON)])],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.excludedScrap).toBe(10)
    expect(result.oeeAffectingScrap).toBe(0)
    expect(result.good).toBe(100)
    expect(result.ratio).toBeCloseTo(1.0)
  })

  it('100 produced, 10 scrap no reasonId → oeeAffectingScrap=10, quality=0.9', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [joGroup([entry(10, null)])],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.oeeAffectingScrap).toBe(10)
    expect(result.ratio).toBeCloseTo(0.9)
    expect(result.diagnostics).toHaveLength(0)
  })

  it('100 produced, 10 scrap unknown reasonId → oeeAffectingScrap=10, warning diag, quality=0.9', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [joGroup([entry(10, UNKNOWN_REASON)])],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.oeeAffectingScrap).toBe(10)
    expect(result.ratio).toBeCloseTo(0.9)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe('unknown_scrap_reason_treated_as_oee_affecting')
    expect(result.diagnostics[0].severity).toBe('warning')
  })

  it('50 produced, 100 scrap OEE-affecting → good=0 (clamped), diag scrap_exceeds_total', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 50,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [joGroup([entry(100, OEE_REASON)])],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.good).toBe(0)
    expect(result.oeeAffectingScrap).toBe(100)
    expect(result.diagnostics.some(d => d.code === 'scrap_exceeds_total')).toBe(true)
  })

  it('total=0 → no_context + no_production_total diag', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 0,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.status).toBe('no_context')
    expect(result.ratio).toBe(0)
    expect(result.diagnostics.some(d => d.code === 'no_production_total')).toBe(true)
  })

  it('mixed scrap (OEE-affecting + excluded + unknown) — each bucket accumulates independently', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 300,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        joGroup([entry(10, OEE_REASON), entry(20, NON_OEE_REASON), entry(30, UNKNOWN_REASON)]),
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.total).toBe(300)
    expect(result.oeeAffectingScrap).toBe(40) // 10 + 30
    expect(result.excludedScrap).toBe(20)
    expect(result.totalScrap).toBe(60)
    expect(result.good).toBe(260)
    expect(
      result.diagnostics.some(d => d.code === 'unknown_scrap_reason_treated_as_oee_affecting'),
    ).toBe(true)
  })
})

// ── Prorating tests (scrap vs clipped JO window) ──────────────────────────────

describe('calculateQuality — scrap prorating vs clipped JO window', () => {
  const JO_WIN_START = new Date('2026-01-01T08:00:00.000Z')
  const JO_WIN_END = new Date('2026-01-01T10:00:00.000Z') // 2h window

  it('scrap fully inside JO window → effective = full amount', () => {
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [
            {
              amount: 10,
              reasonId: OEE_REASON,
              startTime: new Date('2026-01-01T08:30:00.000Z'),
              endTime: new Date('2026-01-01T09:30:00.000Z'),
            },
          ],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.oeeAffectingScrap).toBeCloseTo(10)
  })

  it('scrap overlaps window at start only (entry extends before window.start) → effective = amount × (overlapMs / entryDurationMs)', () => {
    // Entry: 07:00–09:00 (2h), window 08:00–10:00 → overlap = 08:00–09:00 = 1h, entry = 2h → 0.5
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [
            {
              amount: 10,
              reasonId: OEE_REASON,
              startTime: new Date('2026-01-01T07:00:00.000Z'),
              endTime: new Date('2026-01-01T09:00:00.000Z'),
            },
          ],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.oeeAffectingScrap).toBeCloseTo(5) // 10 × (1h/2h)
  })

  it('scrap overlaps window at end only (entry extends past window.end) → effective = amount × (overlapMs / entryDurationMs)', () => {
    // Entry: 09:00–11:00 (2h), window 08:00–10:00 → overlap = 09:00–10:00 = 1h → 0.5
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [
            {
              amount: 10,
              reasonId: OEE_REASON,
              startTime: new Date('2026-01-01T09:00:00.000Z'),
              endTime: new Date('2026-01-01T11:00:00.000Z'),
            },
          ],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.oeeAffectingScrap).toBeCloseTo(5) // 10 × (1h/2h)
  })

  it('scrap entry fully engulfs JO window → effective = amount × (windowMs / entryDurationMs)', () => {
    // Entry: 06:00–12:00 (6h), window 08:00–10:00 (2h) → overlap = 2h → 10 × (2/6) ≈ 3.333
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [
            {
              amount: 10,
              reasonId: OEE_REASON,
              startTime: new Date('2026-01-01T06:00:00.000Z'),
              endTime: new Date('2026-01-01T12:00:00.000Z'),
            },
          ],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.oeeAffectingScrap).toBeCloseTo(10 * (2 / 6))
  })

  it('scrap entry fully outside JO window → contributes 0, no diag', () => {
    // Entry: 11:00–12:00, window 08:00–10:00 → no overlap
    const result = calculateQuality({
      grossProducedAcrossExecution: 100,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [
            {
              amount: 10,
              reasonId: OEE_REASON,
              startTime: new Date('2026-01-01T11:00:00.000Z'),
              endTime: new Date('2026-01-01T12:00:00.000Z'),
            },
          ],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(result.oeeAffectingScrap).toBe(0)
    expect(result.excludedScrap).toBe(0)
    expect(result.diagnostics).toHaveLength(0)
  })

  it('reasonId classification applied to prorated amount — all 4 variants with partial-overlap entry', () => {
    // Entry: 07:00–09:00 (2h), window 08:00–10:00, overlap = 1h → ratio = 0.5
    // Each entry has amount=20 → effective = 10 each
    const partialEntry = (reasonId: string | null) => ({
      amount: 20,
      reasonId,
      startTime: new Date('2026-01-01T07:00:00.000Z'),
      endTime: new Date('2026-01-01T09:00:00.000Z'),
    })

    // null → oeeAffecting
    const r1 = calculateQuality({
      grossProducedAcrossExecution: 200,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [partialEntry(null)],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(r1.oeeAffectingScrap).toBeCloseTo(10)
    expect(r1.excludedScrap).toBe(0)

    // unknown → oeeAffecting + warning
    const r2 = calculateQuality({
      grossProducedAcrossExecution: 200,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [partialEntry(UNKNOWN_REASON)],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(r2.oeeAffectingScrap).toBeCloseTo(10)
    expect(
      r2.diagnostics.some(d => d.code === 'unknown_scrap_reason_treated_as_oee_affecting'),
    ).toBe(true)

    // nonOee → excludedScrap
    const r3 = calculateQuality({
      grossProducedAcrossExecution: 200,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [partialEntry(NON_OEE_REASON)],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(r3.excludedScrap).toBeCloseTo(10)
    expect(r3.oeeAffectingScrap).toBe(0)

    // oee-affecting → oeeAffectingScrap
    const r4 = calculateQuality({
      grossProducedAcrossExecution: 200,
      quantityAdjustmentSum: 0,
      scrapEntriesByJobOrder: [
        {
          clippedJobOrderWindow: { start: JO_WIN_START, end: JO_WIN_END },
          entries: [partialEntry(OEE_REASON)],
        },
      ],
      nonOeeReasonIds: NON_OEE_REASON_IDS,
      knownReasonIds: KNOWN_REASON_IDS,
    })
    expect(r4.oeeAffectingScrap).toBeCloseTo(10)
    expect(r4.excludedScrap).toBe(0)
  })
})
