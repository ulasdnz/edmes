import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as workCenterClient from '../../lib/internal-api/work-center.client.js'
import type { AvailabilityResult } from './availability.calc.js'
import type { OeeRange } from './oee.types.js'
import type { ProductivityResult } from './productivity.calc.js'
import type { QualityResult } from './quality.calc.js'
import { calculateVirtualOee } from './virtual-work-center.js'

vi.mock('../../lib/internal-api/work-center.client.js')

const RANGE: OeeRange = {
  from: new Date('2026-01-01T06:00:00.000Z'),
  to: new Date('2026-01-01T18:00:00.000Z'),
}

const WC_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const WC_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const WC_C = 'cccccccccccccccccccccccc'
const WC_VIRTUAL = 'dddddddddddddddddddddddd'

function makeAvailability(
  ratio: number,
  status: 'ok' | 'no_context' | 'not_calculable' = 'ok',
): AvailabilityResult {
  return {
    status,
    ratio,
    jobOrderTimeMs: 1000,
    oeeEligibleTimeMs: 1000,
    effectiveRunTimeMs: ratio * 1000,
    oeeAffectingStopMs: 0,
    nonEffectiveStopMs: 0,
  }
}

function makeProductivity(
  ratio: number,
  status: 'ok' | 'no_context' | 'not_calculable' = 'ok',
): ProductivityResult {
  return {
    status,
    ratio,
    actualOutput: ratio * 100,
    effectiveTargetOutput: 100,
    fullJobTargetOutput: 100,
    quantityAdjustment: 0,
    actualOutputWindowMode: 'execution_span',
    aggregationMode: 'total_ratio',
    jobOrders: [],
  }
}

function makeQuality(
  ratio: number,
  status: 'ok' | 'no_context' | 'not_calculable' = 'ok',
): QualityResult {
  return {
    status,
    ratio,
    good: ratio * 100,
    total: 100,
    oeeAffectingScrap: 0,
    excludedScrap: 0,
    totalScrap: 0,
    diagnostics: [],
  }
}

function makeInnerResult(
  avail: number,
  prod: number,
  qual: number,
  availStatus: 'ok' | 'no_context' | 'not_calculable' = 'ok',
  prodStatus: 'ok' | 'no_context' | 'not_calculable' = 'ok',
  qualStatus: 'ok' | 'no_context' | 'not_calculable' = 'ok',
) {
  return {
    availability: makeAvailability(avail, availStatus),
    productivity: makeProductivity(prod, prodStatus),
    quality: makeQuality(qual, qualStatus),
  }
}

describe('calculateVirtualOee', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('primary_work_center rule returns first contributor values', async () => {
    vi.mocked(workCenterClient.getById).mockResolvedValue({
      _id: WC_VIRTUAL,
      type: 'virtual',
      metricComposition: {
        availability: {
          rule: 'primary_work_center',
          contributors: [{ workCenterId: WC_A, weight: null }],
        },
        productivity: {
          rule: 'primary_work_center',
          contributors: [{ workCenterId: WC_A, weight: null }],
        },
        quality: {
          rule: 'primary_work_center',
          contributors: [{ workCenterId: WC_A, weight: null }],
        },
      },
    } as never)

    const calculateOeeForWc = vi.fn().mockResolvedValue(makeInnerResult(0.9, 0.8, 0.95))

    const result = await calculateVirtualOee(WC_VIRTUAL, RANGE, new Set(), calculateOeeForWc)

    expect(result.availability.ratio).toBe(0.9)
    expect(result.productivity.ratio).toBe(0.8)
    expect(result.quality.ratio).toBe(0.95)
    expect(result.availability.status).toBe('ok')
    expect(result.oee.ratio).toBeCloseTo(0.9 * 0.8 * 0.95)
    expect(result.oee.status).toBe('ok')
  })

  it('average rule computes arithmetic mean, excludes no_context from denominator', async () => {
    vi.mocked(workCenterClient.getById).mockResolvedValue({
      _id: WC_VIRTUAL,
      type: 'virtual',
      metricComposition: {
        availability: {
          rule: 'average',
          contributors: [
            { workCenterId: WC_A, weight: null },
            { workCenterId: WC_B, weight: null },
            { workCenterId: WC_C, weight: null },
          ],
        },
        productivity: { rule: 'average', contributors: [{ workCenterId: WC_A, weight: null }] },
        quality: { rule: 'average', contributors: [{ workCenterId: WC_A, weight: null }] },
      },
    } as never)

    const calculateOeeForWc = vi.fn().mockImplementation(async (wcId: string) => {
      if (wcId === WC_A) return makeInnerResult(0.8, 0.9, 0.95)
      if (wcId === WC_B) return makeInnerResult(0, 0, 0, 'no_context', 'no_context', 'no_context')
      if (wcId === WC_C) return makeInnerResult(0.6, 0.7, 0.8)
      return makeInnerResult(0, 0, 0)
    })

    const result = await calculateVirtualOee(WC_VIRTUAL, RANGE, new Set(), calculateOeeForWc)

    // WC_B is no_context → excluded from denominator; average of A(0.8) and C(0.6) = 0.7
    expect(result.availability.ratio).toBeCloseTo(0.7)
    expect(result.availability.status).toBe('ok')
  })

  it('average rule bubbles up not_calculable', async () => {
    vi.mocked(workCenterClient.getById).mockResolvedValue({
      _id: WC_VIRTUAL,
      type: 'virtual',
      metricComposition: {
        availability: {
          rule: 'average',
          contributors: [
            { workCenterId: WC_A, weight: null },
            { workCenterId: WC_B, weight: null },
          ],
        },
        productivity: { rule: 'average', contributors: [{ workCenterId: WC_A, weight: null }] },
        quality: { rule: 'average', contributors: [{ workCenterId: WC_A, weight: null }] },
      },
    } as never)

    const calculateOeeForWc = vi.fn().mockImplementation(async (wcId: string) => {
      if (wcId === WC_A) return makeInnerResult(0.8, 0.9, 0.95)
      if (wcId === WC_B)
        return makeInnerResult(0, 0, 0, 'not_calculable', 'not_calculable', 'not_calculable')
      return makeInnerResult(0, 0, 0)
    })

    const result = await calculateVirtualOee(WC_VIRTUAL, RANGE, new Set(), calculateOeeForWc)

    expect(result.availability.status).toBe('not_calculable')
    expect(result.oee.status).toBe('not_calculable')
  })

  it('3-level recursion computes correctly (WC_TOP → WC_MID virtual → WC_LEAF physical)', async () => {
    const WC_TOP = 'eeeeeeeeeeeeeeeeeeeeeeee'
    const WC_MID = 'ffffffffffffffffffffffff'
    const WC_LEAF = 'aaaaaaaaaaaaaaaaaaaaaaab'

    vi.mocked(workCenterClient.getById).mockImplementation(async (wcId: string) => {
      if (wcId === WC_TOP) {
        return {
          _id: WC_TOP,
          type: 'virtual',
          metricComposition: {
            availability: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_MID, weight: null }],
            },
            productivity: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_MID, weight: null }],
            },
            quality: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_MID, weight: null }],
            },
          },
        } as never
      }
      if (wcId === WC_MID) {
        return {
          _id: WC_MID,
          type: 'virtual',
          metricComposition: {
            availability: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_LEAF, weight: null }],
            },
            productivity: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_LEAF, weight: null }],
            },
            quality: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_LEAF, weight: null }],
            },
          },
        } as never
      }
      return null
    })

    const calculateOeeForWc = vi
      .fn()
      .mockImplementation(async (wcId: string, _r: OeeRange, visited: Set<string>) => {
        if (wcId === WC_MID) {
          // WC_MID is virtual — recurse into calculateVirtualOee
          return calculateVirtualOee(WC_MID, _r, visited, calculateOeeForWc)
        }
        if (wcId === WC_LEAF) return makeInnerResult(1.0, 0.9, 0.8)
        return makeInnerResult(0, 0, 0)
      })

    const result = await calculateVirtualOee(WC_TOP, RANGE, new Set(), calculateOeeForWc)

    expect(result.availability.ratio).toBeCloseTo(1.0)
    expect(result.productivity.ratio).toBeCloseTo(0.9)
    expect(result.quality.ratio).toBeCloseTo(0.8)
    expect(result.availability.status).toBe('ok')
    expect(result.oee.status).toBe('ok')
  })

  it('cycle detection: A → B → A does not infinite-recurse and returns not_calculable with diagnostic', async () => {
    const WC_A2 = 'cccccccccccccccccccccccc'
    const WC_B2 = 'dddddddddddddddddddddddd'

    vi.mocked(workCenterClient.getById).mockImplementation(async (wcId: string) => {
      if (wcId === WC_A2) {
        return {
          _id: WC_A2,
          type: 'virtual',
          metricComposition: {
            availability: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_B2, weight: null }],
            },
            productivity: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_B2, weight: null }],
            },
            quality: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_B2, weight: null }],
            },
          },
        } as never
      }
      if (wcId === WC_B2) {
        return {
          _id: WC_B2,
          type: 'virtual',
          metricComposition: {
            availability: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_A2, weight: null }],
            },
            productivity: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_A2, weight: null }],
            },
            quality: {
              rule: 'primary_work_center',
              contributors: [{ workCenterId: WC_A2, weight: null }],
            },
          },
        } as never
      }
      return null
    })

    const calculateOeeForWc = vi
      .fn()
      .mockImplementation(async (wcId: string, r: OeeRange, visited: Set<string>) => {
        return calculateVirtualOee(wcId, r, visited, calculateOeeForWc)
      })

    const result = await calculateVirtualOee(WC_A2, RANGE, new Set(), calculateOeeForWc)

    // Must complete without stack overflow
    expect(result.availability.status).toBe('not_calculable')
    expect(result.oee.status).toBe('not_calculable')
    expect(
      result.diagnostics.some(
        d =>
          d.code === 'virtual_work_center_cycle' &&
          (d.context as { workCenterId?: string })?.workCenterId === WC_A2,
      ),
    ).toBe(true)
  })

  it('weighted rule with missing weights treats them as equal weights', async () => {
    vi.mocked(workCenterClient.getById).mockResolvedValue({
      _id: WC_VIRTUAL,
      type: 'virtual',
      metricComposition: {
        availability: {
          rule: 'weighted',
          contributors: [
            { workCenterId: WC_A, weight: null },
            { workCenterId: WC_B, weight: null },
          ],
        },
        productivity: { rule: 'average', contributors: [{ workCenterId: WC_A, weight: null }] },
        quality: { rule: 'average', contributors: [{ workCenterId: WC_A, weight: null }] },
      },
    } as never)

    const calculateOeeForWc = vi.fn().mockImplementation(async (wcId: string) => {
      if (wcId === WC_A) return makeInnerResult(0.8, 0.9, 0.95)
      if (wcId === WC_B) return makeInnerResult(0.6, 0.7, 0.8)
      return makeInnerResult(0, 0, 0)
    })

    const result = await calculateVirtualOee(WC_VIRTUAL, RANGE, new Set(), calculateOeeForWc)

    // Equal weights: (0.8 + 0.6) / 2 = 0.7
    expect(result.availability.ratio).toBeCloseTo(0.7)
  })

  it('cycle detection returns not_calculable with diagnostic', async () => {
    const visited = new Set([WC_VIRTUAL])
    const calculateOeeForWc = vi.fn()

    const result = await calculateVirtualOee(WC_VIRTUAL, RANGE, visited, calculateOeeForWc)

    expect(result.availability.status).toBe('not_calculable')
    expect(result.oee.status).toBe('not_calculable')
    expect(result.diagnostics.some(d => (d.code as string) === 'virtual_work_center_cycle')).toBe(
      true,
    )
    expect(calculateOeeForWc).not.toHaveBeenCalled()
  })
})
