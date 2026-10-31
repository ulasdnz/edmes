import { describe, expect, it } from 'vitest'
import { normalize } from './interval-normalizer.js'
import type { JobWindow, OeeRange, StopInterval } from './oee.types.js'

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes, 0))

const MICRO_STOP_ID = '00000000000000000000aa01'
const WC = '00000000000000000000bb01'

const range: OeeRange = { from: t(0), to: t(100) }

function jw(start: number, end: number, overrides: Partial<JobWindow> = {}): JobWindow {
  return {
    jobOrderId: overrides.jobOrderId ?? 'jo1',
    productId: overrides.productId ?? 'p1',
    workCenterId: overrides.workCenterId ?? WC,
    start: t(start),
    end: t(end),
  }
}

function planned(
  id: string,
  start: number,
  end: number,
  reasonId: string | null = 'reason-plan',
): StopInterval {
  return {
    _id: id,
    workCenterId: WC,
    reasonId,
    source: 'planned',
    start: t(start),
    end: t(end),
  }
}

function unplanned(
  id: string,
  start: number,
  end: number,
  reasonId: string | null = 'reason-unp',
  linkedPlannedStopId?: string | null,
): StopInterval {
  return {
    _id: id,
    workCenterId: WC,
    reasonId,
    source: 'unplanned',
    start: t(start),
    end: t(end),
    linkedPlannedStopId: linkedPlannedStopId ?? null,
  }
}

describe('interval-normalizer.normalize', () => {
  it('emits no_job_order_in_range when there are no job windows', () => {
    const out = normalize({
      range,
      jobOrderWindows: [],
      planned: [],
      unplanned: [],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })

    expect(out.clippedJobWindows).toEqual([])
    expect(out.productionRunWindows).toEqual([])
    expect(out.diagnostics.some(d => d.code === 'no_job_order_in_range')).toBe(true)
  })

  it('splits a job window around a fully-internal stop', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(0, 100)],
      planned: [planned('p1', 30, 40)],
      unplanned: [],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.productionRunWindows).toEqual([
      { from: t(0), to: t(30) },
      { from: t(40), to: t(100) },
    ])
  })

  it('clips a stop crossing a job window boundary', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(10, 90)],
      planned: [planned('p1', 0, 50)],
      unplanned: [],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.productionRunWindows).toEqual([{ from: t(50), to: t(90) }])
  })

  it('keeps production windows intact when stop is fully outside job window', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(40, 60)],
      planned: [planned('p1', 0, 30)],
      unplanned: [],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.productionRunWindows).toEqual([{ from: t(40), to: t(60) }])
    expect(out.calculationStops).toHaveLength(1)
  })

  it('applies planned precedence and emits overlapping_stop_records_clipped', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(0, 100)],
      planned: [planned('p1', 30, 60, 'reason-plan')],
      unplanned: [unplanned('u1', 40, 70, 'reason-unp')],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.calculationStops).toHaveLength(2)
    const pStops = out.calculationStops.filter(s => s.source === 'planned')
    const uStops = out.calculationStops.filter(s => s.source === 'unplanned')
    expect(pStops[0].start).toEqual(t(30))
    expect(pStops[0].end).toEqual(t(60))
    expect(uStops[0].start).toEqual(t(60))
    expect(uStops[0].end).toEqual(t(70))
    expect(out.diagnostics.some(d => d.code === 'overlapping_stop_records_clipped')).toBe(true)
  })

  it('does not emit clipping diagnostic for touching planned/unplanned (off-by-one safe)', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(0, 100)],
      planned: [planned('p1', 20, 40)],
      unplanned: [unplanned('u1', 40, 60)],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.diagnostics.some(d => d.code === 'overlapping_stop_records_clipped')).toBe(false)
    expect(out.calculationStops).toHaveLength(2)
  })

  it('excludes MICRO_STOP and does not split production windows', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(0, 100)],
      planned: [],
      unplanned: [unplanned('u1', 30, 40, MICRO_STOP_ID)],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.calculationStops).toEqual([])
    expect(out.productionRunWindows).toEqual([{ from: t(0), to: t(100) }])
  })

  it('marks non-effective reasons via nonOeeReasonIds set', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(0, 100)],
      planned: [planned('p1', 10, 20, 'reason-non-oee')],
      unplanned: [],
      nonOeeReasonIds: new Set(['reason-non-oee']),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.calculationStops).toHaveLength(1)
    expect(out.calculationStops[0].effectiveAffectsOee).toBe(false)
  })

  it('treats unplanned without a reason as OEE-affecting', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(0, 100)],
      planned: [],
      unplanned: [unplanned('u1', 10, 20, null)],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.calculationStops).toHaveLength(1)
    expect(out.calculationStops[0].effectiveAffectsOee).toBe(true)
  })

  it('inherits the linked planned reason for converted unplanned remainders', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(0, 100)],
      planned: [planned('p1', 10, 20, 'reason-non-oee')],
      unplanned: [unplanned('u1', 0, 20, 'reason-orig', 'p1')],
      nonOeeReasonIds: new Set(['reason-non-oee']),
      microStopReasonId: MICRO_STOP_ID,
    })
    const uStops = out.calculationStops.filter(s => s.source === 'unplanned')
    expect(uStops).toHaveLength(1)
    expect(uStops[0].start).toEqual(t(0))
    expect(uStops[0].end).toEqual(t(10))
    expect(uStops[0].reasonId).toBe('reason-non-oee')
    expect(uStops[0].effectiveAffectsOee).toBe(false)
    expect(out.diagnostics.some(d => d.code === 'overlapping_stop_records_clipped')).toBe(false)
  })

  it('emits converted_unplanned_missing_link when linked planned is absent', () => {
    const out = normalize({
      range,
      jobOrderWindows: [jw(0, 100)],
      planned: [],
      unplanned: [unplanned('u1', 0, 20, 'reason-orig', 'p-missing')],
      nonOeeReasonIds: new Set(),
      microStopReasonId: MICRO_STOP_ID,
    })
    expect(out.diagnostics.some(d => d.code === 'converted_unplanned_missing_link')).toBe(true)
    const uStops = out.calculationStops.filter(s => s.source === 'unplanned')
    expect(uStops[0].reasonId).toBe('reason-orig')
  })

  it('normalizes 500 job orders and 2000 stops within 200ms', () => {
    const jobs: JobWindow[] = []
    for (let i = 0; i < 500; i++) {
      const s = i * 200
      jobs.push({
        jobOrderId: `jo-${i}`,
        productId: 'p1',
        workCenterId: WC,
        start: new Date(s * 1000),
        end: new Date((s + 150) * 1000),
      })
    }
    const stops: StopInterval[] = []
    for (let i = 0; i < 2000; i++) {
      const s = i * 50
      stops.push({
        _id: `s-${i}`,
        workCenterId: WC,
        reasonId: 'r1',
        source: i % 2 === 0 ? 'planned' : 'unplanned',
        start: new Date(s * 1000),
        end: new Date((s + 20) * 1000),
      })
    }
    const bigRange: OeeRange = { from: new Date(0), to: new Date(500 * 200 * 1000) }

    const input = {
      range: bigRange,
      jobOrderWindows: jobs,
      planned: stops.filter(s => s.source === 'planned'),
      unplanned: stops.filter(s => s.source === 'unplanned'),
      nonOeeReasonIds: new Set<string>(),
      microStopReasonId: MICRO_STOP_ID,
    }

    // The fastest of a few runs: the first also compiles the code, and on a busy machine any one
    // run can wait for a CPU, neither of which says anything about the algorithm
    const durations = Array.from({ length: 5 }, () => {
      const started = performance.now()
      normalize(input)
      return performance.now() - started
    })
    expect(Math.min(...durations)).toBeLessThan(200)
  })
})
