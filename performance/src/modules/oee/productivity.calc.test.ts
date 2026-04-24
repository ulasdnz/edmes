import { describe, expect, it } from 'vitest'
import {
  calculateProductivity,
  isNonOverlapping,
  type ProductivityInput,
} from './productivity.calc.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const T0 = new Date('2026-01-01T06:00:00.000Z')
const T1 = new Date('2026-01-01T07:00:00.000Z') // +60 min
const T2 = new Date('2026-01-01T08:00:00.000Z') // +120 min

const JO_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const WC_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PROD_ID = 'cccccccccccccccccccccccc'

function makeInput(overrides: Partial<ProductivityInput> = {}): ProductivityInput {
  return {
    jobOrders: [
      {
        jobOrderId: JO_ID,
        workCenterId: WC_ID,
        productId: PROD_ID,
        start: T0,
        end: T1,
      },
    ],
    clippedJobWindows: [
      { jobOrderId: JO_ID, workCenterId: WC_ID, productId: PROD_ID, start: T0, end: T1 },
    ],
    productionRunWindows: [{ from: T0, to: T1 }],
    productStandardsByJobOrderId: {
      [JO_ID]: [
        {
          _id: 'std1',
          validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          idealOutputPerMinute: 1000 / 60, // 1000 per hour
          counterMultiplier: 1,
          idealSpeed: null,
        },
      ],
    },
    quantityAdjustmentsByJobOrderId: {},
    producedSummaryByTagId: {},
    speedSummaryByTagId: {},
    productivityMode: 'count_based',
    producedCounterTagId: 'tag-counter',
    speedTagId: undefined,
    actualOutputWindowMode: 'execution_span',
    productivityAggregationMode: 'total_ratio',
    allowProductivityOver100: true,
    ...overrides,
  }
}

// ── isNonOverlapping ──────────────────────────────────────────────────────────

describe('isNonOverlapping', () => {
  it('returns true for non-overlapping windows', () => {
    expect(
      isNonOverlapping([
        { from: T0, to: T1 },
        { from: T1, to: T2 },
      ]),
    ).toBe(true)
  })

  it('returns false for overlapping windows', () => {
    const mid = new Date(T0.getTime() + 30 * 60 * 1000)
    expect(
      isNonOverlapping([
        { from: T0, to: T1 },
        { from: mid, to: T2 },
      ]),
    ).toBe(false)
  })

  it('returns true for empty array', () => {
    expect(isNonOverlapping([])).toBe(true)
  })
})

// ── Count-based tests ─────────────────────────────────────────────────────────

describe('calculateProductivity — count_based', () => {
  it('60-min JO, 1000-count standard per hour, actual 900, no stops → ratio=0.9', () => {
    const input = makeInput({
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [
            {
              from: T0.toISOString(),
              to: T1.toISOString(),
              value: 900,
              qualityFlags: [],
            },
          ],
          total: 900,
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    expect(result.ratio).toBeCloseTo(0.9, 5)
    expect(result.jobOrders[0].ratio).toBeCloseTo(0.9, 5)
    expect(result.jobOrders[0].actualOutput).toBeCloseTo(900, 5)
    expect(result.jobOrders[0].notCalculable).toBe(false)
  })

  it('count-based with quantity adjustment: amount=-50 applied inside window', () => {
    const input = makeInput({
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [
            {
              from: T0.toISOString(),
              to: T1.toISOString(),
              value: 900,
              qualityFlags: [],
            },
          ],
          total: 900,
        },
      },
      quantityAdjustmentsByJobOrderId: {
        [JO_ID]: [{ _id: 'adj1', amount: -50, time: new Date(T0.getTime() + 10 * 60 * 1000) }],
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    expect(result.jobOrders[0].actualOutput).toBeCloseTo(850, 5)
    expect(result.jobOrders[0].quantityAdjustment).toBeCloseTo(-50, 5)
  })

  it('execution_span vs net_run_segments differ when stop inside JO', () => {
    // A 60-min JO with a 20-min non-effective stop in the middle.
    // execution_span: the full JO window is used to fetch produced counts.
    // net_run_segments: only the 40 running minutes are used.
    // With a target of 1000/hr and actual production of 1000 in 60 min:
    //   execution_span target = 1000 → ratio = 1.0
    //   net_run_segments target = 1000*(40/60) ≈ 666.7 → ratio ≈ 1.5 (> 1)
    const stopStart = new Date(T0.getTime() + 20 * 60 * 1000)
    const stopEnd = new Date(T0.getTime() + 40 * 60 * 1000)

    // net_run_segments: production run windows exclude the 20-min stop
    const runWindow1 = { from: T0, to: stopStart }
    const runWindow2 = { from: stopEnd, to: T1 }

    const executionInput = makeInput({
      actualOutputWindowMode: 'execution_span',
      productionRunWindows: [runWindow1, runWindow2],
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [
            { from: T0.toISOString(), to: T1.toISOString(), value: 1000, qualityFlags: [] },
          ],
          total: 1000,
        },
      },
    })

    const netInput = makeInput({
      actualOutputWindowMode: 'net_run_segments',
      productionRunWindows: [runWindow1, runWindow2],
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [
            { from: T0.toISOString(), to: stopStart.toISOString(), value: 333, qualityFlags: [] },
            { from: stopEnd.toISOString(), to: T1.toISOString(), value: 667, qualityFlags: [] },
          ],
          total: 1000,
        },
      },
    })

    const execResult = calculateProductivity(executionInput)
    const netResult = calculateProductivity(netInput)

    // execution_span: target based on full 60-min window → ratio=1.0
    expect(execResult.jobOrders[0].ratio).toBeCloseTo(1.0, 3)

    // net_run_segments: target based on 40-min run window only
    const targetNetMinutes = 40
    const expectedTarget = (1000 / 60) * targetNetMinutes
    expect(netResult.jobOrders[0].effectiveTargetOutput).toBeCloseTo(expectedTarget, 1)
  })

  it('missing baseline standard → job order notCalculable, overall status not_calculable', () => {
    const input = makeInput({
      productStandardsByJobOrderId: { [JO_ID]: [] },
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [{ from: T0.toISOString(), to: T1.toISOString(), value: 900, qualityFlags: [] }],
          total: 900,
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('not_calculable')
    expect(result.jobOrders[0].notCalculable).toBe(true)
  })

  it('allowProductivityOver100=false caps per-JO ratio at 1.0 before aggregation', () => {
    const input = makeInput({
      allowProductivityOver100: false,
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [
            {
              from: T0.toISOString(),
              to: T1.toISOString(),
              value: 2000,
              qualityFlags: [],
            },
          ],
          total: 2000,
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    expect(result.ratio).toBeCloseTo(1.0, 5)
    expect(result.jobOrders[0].ratio).toBeCloseTo(1.0, 5)
  })

  it('run_time_weighted_ratio aggregation: two JOs with different productionRunMs', () => {
    const JO_ID_2 = 'eeeeeeeeeeeeeeeeeeeeeeee'
    const T_HALF = new Date(T0.getTime() + 30 * 60 * 1000)

    // JO1: 60-min run, ratio=0.8; JO2: 30-min run, ratio=0.4
    // weighted = (0.8 * 60 + 0.4 * 30) / (60 + 30) = (48 + 12) / 90 = 60/90 ≈ 0.667
    const input: ProductivityInput = {
      jobOrders: [
        { jobOrderId: JO_ID, workCenterId: WC_ID, productId: PROD_ID, start: T0, end: T1 },
        { jobOrderId: JO_ID_2, workCenterId: WC_ID, productId: PROD_ID, start: T1, end: T2 },
      ],
      clippedJobWindows: [
        { jobOrderId: JO_ID, workCenterId: WC_ID, productId: PROD_ID, start: T0, end: T1 },
        { jobOrderId: JO_ID_2, workCenterId: WC_ID, productId: PROD_ID, start: T1, end: T2 },
      ],
      productionRunWindows: [
        { from: T0, to: T1 },
        { from: T1, to: T2 },
      ],
      productStandardsByJobOrderId: {
        [JO_ID]: [
          {
            _id: 'std1',
            validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            idealOutputPerMinute: 1000 / 60,
            counterMultiplier: 1,
            idealSpeed: null,
          },
        ],
        [JO_ID_2]: [
          {
            _id: 'std2',
            validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            idealOutputPerMinute: 1000 / 60,
            counterMultiplier: 1,
            idealSpeed: null,
          },
        ],
      },
      quantityAdjustmentsByJobOrderId: {},
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [
            { from: T0.toISOString(), to: T1.toISOString(), value: 800, qualityFlags: [] },
            { from: T1.toISOString(), to: T2.toISOString(), value: 200, qualityFlags: [] },
          ],
          total: 1000,
        },
      },
      speedSummaryByTagId: {},
      productivityMode: 'count_based',
      producedCounterTagId: 'tag-counter',
      speedTagId: undefined,
      actualOutputWindowMode: 'execution_span',
      productivityAggregationMode: 'run_time_weighted_ratio',
      allowProductivityOver100: true,
    }

    const result = calculateProductivity(input)

    // JO1: target=1000, actual=800, ratio=0.8, runMs=3600000
    // JO2: target=1000, actual=200, ratio=0.2, runMs=3600000
    // weighted = (0.8*3600000 + 0.2*3600000) / (3600000+3600000) = 0.5
    expect(result.status).toBe('ok')
    expect(result.productivityAggregationMode).toBe('run_time_weighted_ratio')
    // with equal run times, weighted average = simple average
    expect(result.ratio).toBeCloseTo(0.5, 3)
  })

  it('empty actualOutputWindows → ratio=0, not NaN', () => {
    // net_run_segments where productionRunWindows don't intersect any JO
    const input = makeInput({
      actualOutputWindowMode: 'net_run_segments',
      productionRunWindows: [],
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [],
          total: 0,
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.jobOrders[0].ratio).toBe(0)
    expect(Number.isNaN(result.jobOrders[0].ratio)).toBe(false)
  })

  it('productionRunMs=0 under run_time_weighted_ratio → no div-by-zero', () => {
    const input = makeInput({
      actualOutputWindowMode: 'net_run_segments',
      productionRunWindows: [],
      productivityAggregationMode: 'run_time_weighted_ratio',
      producedSummaryByTagId: {
        'tag-counter': { windows: [], total: 0 },
      },
    })

    const result = calculateProductivity(input)

    expect(Number.isNaN(result.ratio)).toBe(false)
    expect(result.ratio).toBe(0)
  })
})

// ── Speed-based tests ─────────────────────────────────────────────────────────

describe('calculateProductivity — speed_based', () => {
  it('constant speed matching target → ratio=1.0', () => {
    // idealOutputPerMinute=100, counterMultiplier=1
    // In speed mode: actualOutput = Σ (valueArea_subWindow × counterMultiplier)
    // valueArea unit is (speed_unit × ms). We need actual in same units as idealOutputPerMinute.
    // Convert: actualOutput = valueArea × counterMultiplier / 60000 (ms→minutes)
    // For 60-min window at 100/min: target=6000
    // valueArea = 100 units/min × 3600000ms = 360000000 unit·ms → / 60000 = 6000 actual
    const valueArea = 100 * 60 * 60 * 1000 // 100 (units/min) × 60min × 60s × 1000ms

    const input = makeInput({
      productivityMode: 'speed_based',
      producedCounterTagId: undefined,
      speedTagId: 'tag-speed',
      productStandardsByJobOrderId: {
        [JO_ID]: [
          {
            _id: 'std1',
            validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            idealOutputPerMinute: 100,
            counterMultiplier: 1,
            idealSpeed: 100,
          },
        ],
      },
      speedSummaryByTagId: {
        'tag-speed': {
          windows: [
            {
              from: T0.toISOString(),
              to: T1.toISOString(),
              durationMs: 60 * 60 * 1000,
              timeWeightedAverage: 100,
              valueArea,
              sampleCount: 60,
            },
          ],
          total: {
            durationMs: 60 * 60 * 1000,
            timeWeightedAverage: 100,
            valueArea,
          },
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    expect(result.ratio).toBeCloseTo(1.0, 3)
  })

  it('product standard change mid-job: windows split; target computed correctly', () => {
    // JO: T0 to T2 (120 min)
    // Standard 1 (validFrom before T0): 1000/60 per min → applies to [T0, T1)
    // Standard 2 (validFrom T1): 2000/60 per min → applies to [T1, T2)
    // Target = 1000 (60 min at std1) + 2000 (60 min at std2) = 3000
    const input = makeInput({
      jobOrders: [
        { jobOrderId: JO_ID, workCenterId: WC_ID, productId: PROD_ID, start: T0, end: T2 },
      ],
      clippedJobWindows: [
        { jobOrderId: JO_ID, workCenterId: WC_ID, productId: PROD_ID, start: T0, end: T2 },
      ],
      productionRunWindows: [{ from: T0, to: T2 }],
      productStandardsByJobOrderId: {
        [JO_ID]: [
          {
            _id: 'std1',
            validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            idealOutputPerMinute: 1000 / 60,
            counterMultiplier: 1,
            idealSpeed: null,
          },
          {
            _id: 'std2',
            validFrom: T1.toISOString(),
            idealOutputPerMinute: 2000 / 60,
            counterMultiplier: 1,
            idealSpeed: null,
          },
        ],
      },
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [
            { from: T0.toISOString(), to: T2.toISOString(), value: 3000, qualityFlags: [] },
          ],
          total: 3000,
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    expect(result.jobOrders[0].effectiveTargetOutput).toBeCloseTo(3000, 1)
    expect(result.ratio).toBeCloseTo(1.0, 3)
  })
})
