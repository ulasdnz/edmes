import { describe, expect, it } from 'vitest'
import { calculateAvailability } from './availability.calc.js'
import type { JobWindow, NormalizedStop } from './oee.types.js'

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes, 0))
const WC = '00000000000000000000bb01'

function jw(start: number, end: number): JobWindow {
  return { jobOrderId: 'jo1', productId: 'p1', workCenterId: WC, start: t(start), end: t(end) }
}

function stop(
  id: string,
  start: number,
  end: number,
  effectiveAffectsOee: boolean,
  source: 'planned' | 'unplanned' = 'unplanned',
): NormalizedStop {
  return {
    _id: id,
    workCenterId: WC,
    reasonId: 'r',
    source,
    start: t(start),
    end: t(end),
    effectiveAffectsOee,
    isMicroStop: false,
  }
}

const MIN = 60_000

describe('calculateAvailability', () => {
  it('100-min JO + 10-min OEE-affecting stop → ratio 0.9', () => {
    const r = calculateAvailability({
      clippedJobWindows: [jw(0, 100)],
      calculationStops: [stop('s1', 30, 40, true)],
    })
    expect(r.status).toBe('ok')
    expect(r.jobOrderTimeMs).toBe(100 * MIN)
    expect(r.oeeAffectingStopMs).toBe(10 * MIN)
    expect(r.nonEffectiveStopMs).toBe(0)
    expect(r.effectiveRunTimeMs).toBe(90 * MIN)
    expect(r.oeeEligibleTimeMs).toBe(100 * MIN)
    expect(r.ratio).toBeCloseTo(0.9, 6)
  })

  it('100-min JO + 10-min non-effective stop → ratio 1.0', () => {
    const r = calculateAvailability({
      clippedJobWindows: [jw(0, 100)],
      calculationStops: [stop('s1', 30, 40, false)],
    })
    expect(r.status).toBe('ok')
    expect(r.oeeAffectingStopMs).toBe(0)
    expect(r.nonEffectiveStopMs).toBe(10 * MIN)
    expect(r.effectiveRunTimeMs).toBe(90 * MIN)
    expect(r.oeeEligibleTimeMs).toBe(90 * MIN)
    expect(r.ratio).toBeCloseTo(1, 6)
  })

  it('100-min JO with no stops (MICRO_STOP already excluded) → ratio 1.0', () => {
    const r = calculateAvailability({
      clippedJobWindows: [jw(0, 100)],
      calculationStops: [],
    })
    expect(r.ratio).toBeCloseTo(1, 6)
    expect(r.effectiveRunTimeMs).toBe(100 * MIN)
    expect(r.oeeEligibleTimeMs).toBe(100 * MIN)
  })

  it('10-min no-reason unplanned is treated as OEE-affecting when flag is true', () => {
    const r = calculateAvailability({
      clippedJobWindows: [jw(0, 100)],
      calculationStops: [{ ...stop('s1', 30, 40, true), reasonId: null }],
    })
    expect(r.oeeAffectingStopMs).toBe(10 * MIN)
    expect(r.ratio).toBeCloseTo(0.9, 6)
  })

  it('empty job windows → no_context', () => {
    const r = calculateAvailability({
      clippedJobWindows: [],
      calculationStops: [stop('s1', 0, 10, true)],
    })
    expect(r.status).toBe('no_context')
    expect(r.ratio).toBe(0)
    expect(r.jobOrderTimeMs).toBe(0)
  })

  it('mixed OEE-affecting and non-effective stops sum without double-counting', () => {
    const r = calculateAvailability({
      clippedJobWindows: [jw(0, 100)],
      calculationStops: [stop('s1', 10, 20, true), stop('s2', 40, 50, false)],
    })
    expect(r.oeeAffectingStopMs).toBe(10 * MIN)
    expect(r.nonEffectiveStopMs).toBe(10 * MIN)
    expect(r.effectiveRunTimeMs).toBe(80 * MIN)
    expect(r.oeeEligibleTimeMs).toBe(90 * MIN)
    expect(r.ratio).toBeCloseTo(80 / 90, 6)
  })

  it('counts only the intersection when a stop crosses a job window boundary', () => {
    const r = calculateAvailability({
      clippedJobWindows: [jw(10, 90)],
      calculationStops: [stop('s1', 0, 50, true)],
    })
    expect(r.jobOrderTimeMs).toBe(80 * MIN)
    expect(r.oeeAffectingStopMs).toBe(40 * MIN)
    expect(r.effectiveRunTimeMs).toBe(40 * MIN)
    expect(r.ratio).toBeCloseTo(0.5, 6)
  })

  it('ignores stops fully outside any job window', () => {
    const r = calculateAvailability({
      clippedJobWindows: [jw(40, 60)],
      calculationStops: [stop('s1', 0, 30, true)],
    })
    expect(r.oeeAffectingStopMs).toBe(0)
    expect(r.effectiveRunTimeMs).toBe(20 * MIN)
    expect(r.ratio).toBeCloseTo(1, 6)
  })
})
