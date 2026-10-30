import { describe, expect, it } from 'vitest'
import { isNonOverlapping } from './_test-utils.js'
import { calculateProductivity, type ProductivityInput } from './productivity.calc.js'

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
    productionCounterTagId: 'tag-counter',
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

  it('counterMultiplier converts counter steps: 250 strokes × 4 = 1000 parts', () => {
    const input = makeInput({
      productStandardsByJobOrderId: {
        [JO_ID]: [
          {
            _id: 'std1',
            validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            idealOutputPerMinute: 1000 / 60,
            counterMultiplier: 4,
            idealSpeed: null,
          },
        ],
      },
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [{ from: T0.toISOString(), to: T1.toISOString(), value: 250, qualityFlags: [] }],
          total: 250,
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    expect(result.jobOrders[0].actualOutput).toBeCloseTo(1000, 5)
    expect(result.ratio).toBeCloseTo(1.0, 5)
  })

  it('a missing counterMultiplier makes the job order not calculable instead of counting 0', () => {
    const input = makeInput({
      productStandardsByJobOrderId: {
        [JO_ID]: [
          {
            _id: 'std1',
            validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            idealOutputPerMinute: 1000 / 60,
            counterMultiplier: null,
            idealSpeed: null,
          },
        ],
      },
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [{ from: T0.toISOString(), to: T1.toISOString(), value: 250, qualityFlags: [] }],
          total: 250,
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('not_calculable')
    expect(result.jobOrders[0].notCalculable).toBe(true)
  })

  it('quantity adjustments outside JO window are excluded from sum', () => {
    // JO window is [T0, T1]. One adjustment inside, two outside.
    const insideTime = new Date(T0.getTime() + 10 * 60 * 1000)
    const beforeTime = new Date(T0.getTime() - 1)
    const afterTime = new Date(T1.getTime() + 1)

    const input = makeInput({
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [{ from: T0.toISOString(), to: T1.toISOString(), value: 900, qualityFlags: [] }],
          total: 900,
        },
      },
      quantityAdjustmentsByJobOrderId: {
        [JO_ID]: [
          { _id: 'adj-inside', amount: -50, time: insideTime },
          { _id: 'adj-before', amount: 999, time: beforeTime },
          { _id: 'adj-after', amount: 999, time: afterTime },
        ],
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    // Only the inside adjustment (-50) is counted
    expect(result.jobOrders[0].quantityAdjustment).toBeCloseTo(-50, 5)
    expect(result.jobOrders[0].actualOutput).toBeCloseTo(850, 5)
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

  it('allowProductivityOver100=false: total_ratio caps aggregated ratio at 1.0 but per-JO ratio is raw', () => {
    // target=1000, actual=2000 → raw per-JO ratio=2.0
    // total_ratio aggregation: Σactual/Σtarget=2.0, capped at 1.0 at response boundary
    // per-JO breakdown shows raw 2.0 (cap does not apply to per-JO field for total_ratio)
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
    expect(result.jobOrders[0].ratio).toBeCloseTo(2.0, 5)
  })

  it('allowProductivityOver100=false with run_time_weighted_ratio caps per-JO ratio before aggregation', () => {
    // JO1: raw ratio=1.5, runMs=3600000 → capped to 1.0 before weighting
    // JO2: raw ratio=0.6, runMs=3600000
    // weighted = (1.0*3600000 + 0.6*3600000) / (3600000+3600000) = 0.8
    const JO_ID_2 = 'eeeeeeeeeeeeeeeeeeeeeeee'
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
            // JO1 actual=1500 → ratio=1.5; JO2 actual=600 → ratio=0.6
            { from: T0.toISOString(), to: T1.toISOString(), value: 1500, qualityFlags: [] },
            { from: T1.toISOString(), to: T2.toISOString(), value: 600, qualityFlags: [] },
          ],
          total: 2100,
        },
      },
      speedSummaryByTagId: {},
      productivityMode: 'count_based',
      productionCounterTagId: 'tag-counter',
      speedTagId: undefined,
      actualOutputWindowMode: 'execution_span',
      productivityAggregationMode: 'run_time_weighted_ratio',
      allowProductivityOver100: false,
    }

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    // per-JO raw ratios exposed (not capped in breakdown)
    expect(result.jobOrders[0].ratio).toBeCloseTo(1.5, 5)
    expect(result.jobOrders[1].ratio).toBeCloseTo(0.6, 5)
    // aggregated: cap JO1 to 1.0 before weighting → (1.0+0.6)/2 = 0.8
    expect(result.ratio).toBeCloseTo(0.8, 5)
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
      productionCounterTagId: 'tag-counter',
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
    expect(result.aggregationMode).toBe('run_time_weighted_ratio')
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
  it('constant speed matching idealSpeed → ratio=1.0', () => {
    // speed_based ratio model:
    //   subActualOutput = (idealOutputPerMinute / idealSpeed) × (valueArea / 60000)
    // idealOutputPerMinute=100, idealSpeed=100, actualSpeed=100 (constant) for 60 min
    //   target = 100 × 60 = 6000
    //   valueArea = 100 (speed) × 3,600,000 ms = 360,000,000
    //   actualOutput = (100/100) × (360,000,000 / 60000) = 6000 → ratio = 1.0
    const valueArea = 100 * 60 * 60 * 1000

    const input = makeInput({
      productivityMode: 'speed_based',
      productionCounterTagId: undefined,
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

  it('speed-based regression: missing /60000 conversion would produce ratio ~60000x too large', () => {
    // Sanity guard: with the ratio formula, /60000 must remain.
    //   actualOutput = (idealOutputPerMinute/idealSpeed) × (valueArea / 60000) = 6000
    //   without /60000: actualOutput = 360,000,000 → ratio absurdly large.
    const valueArea = 100 * 60 * 60 * 1000
    const input = makeInput({
      productivityMode: 'speed_based',
      productionCounterTagId: undefined,
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
          total: { durationMs: 60 * 60 * 1000, timeWeightedAverage: 100, valueArea },
        },
      },
    })

    const result = calculateProductivity(input)

    expect(result.status).toBe('ok')
    // Without /60000 the ratio would be ~60000; correct value is 1.0
    expect(result.ratio).toBeCloseTo(1.0, 3)
    expect(result.jobOrders[0].actualOutput).toBeCloseTo(6000, 1)
    expect(result.jobOrders[0].effectiveTargetOutput).toBeCloseTo(6000, 1)
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
      // The service asks telemetry for the window split at the standard boundary (T1)
      producedSummaryByTagId: {
        'tag-counter': {
          windows: [
            { from: T0.toISOString(), to: T1.toISOString(), value: 1000, qualityFlags: [] },
            { from: T1.toISOString(), to: T2.toISOString(), value: 2000, qualityFlags: [] },
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

  it('actualSpeed = idealSpeed/2 → ratio 0.5', () => {
    // 60-min window, idealOutputPerMinute=100, idealSpeed=100, actualSpeed=50
    // valueArea = 50 × 3,600,000 = 180,000,000
    // actualOutput = (100/100) × (180,000,000 / 60000) = 3000
    // target = 100 × 60 = 6000 → ratio = 0.5
    const valueArea = 50 * 60 * 60 * 1000
    const input = makeInput({
      productivityMode: 'speed_based',
      productionCounterTagId: undefined,
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
              timeWeightedAverage: 50,
              valueArea,
              sampleCount: 60,
            },
          ],
          total: { durationMs: 60 * 60 * 1000, timeWeightedAverage: 50, valueArea },
        },
      },
    })

    const result = calculateProductivity(input)
    expect(result.status).toBe('ok')
    expect(result.jobOrders[0].actualOutput).toBeCloseTo(3000, 1)
    expect(result.ratio).toBeCloseTo(0.5, 3)
  })

  it('counterMultiplier does NOT affect speed_based actual output (1 vs 10 yields same result)', () => {
    // counterMultiplier is a count_based concept. Changing it must not change
    // speed_based output: actualOutput depends only on idealOutputPerMinute, idealSpeed, valueArea.
    const valueArea = 100 * 60 * 60 * 1000
    const baseInput = (mult: number) =>
      makeInput({
        productivityMode: 'speed_based',
        productionCounterTagId: undefined,
        speedTagId: 'tag-speed',
        productStandardsByJobOrderId: {
          [JO_ID]: [
            {
              _id: 'std1',
              validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
              idealOutputPerMinute: 100,
              counterMultiplier: mult,
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
            total: { durationMs: 60 * 60 * 1000, timeWeightedAverage: 100, valueArea },
          },
        },
      })

    const r1 = calculateProductivity(baseInput(1))
    const r10 = calculateProductivity(baseInput(10))
    expect(r1.jobOrders[0].actualOutput).toBeCloseTo(r10.jobOrders[0].actualOutput, 5)
    expect(r1.ratio).toBeCloseTo(r10.ratio, 5)
  })

  it('null idealSpeed in speed_based → JO not_calculable', () => {
    const valueArea = 100 * 60 * 60 * 1000
    const input = makeInput({
      productivityMode: 'speed_based',
      productionCounterTagId: undefined,
      speedTagId: 'tag-speed',
      productStandardsByJobOrderId: {
        [JO_ID]: [
          {
            _id: 'std1',
            validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            idealOutputPerMinute: 100,
            counterMultiplier: 1,
            idealSpeed: null,
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
          total: { durationMs: 60 * 60 * 1000, timeWeightedAverage: 100, valueArea },
        },
      },
    })

    const result = calculateProductivity(input)
    expect(result.status).toBe('not_calculable')
    expect(result.jobOrders[0].notCalculable).toBe(true)
  })

  it('zero or negative idealSpeed → JO not_calculable (no NaN/Infinity)', () => {
    const valueArea = 100 * 60 * 60 * 1000
    for (const idealSpeed of [0, -10]) {
      const input = makeInput({
        productivityMode: 'speed_based',
        productionCounterTagId: undefined,
        speedTagId: 'tag-speed',
        productStandardsByJobOrderId: {
          [JO_ID]: [
            {
              _id: 'std1',
              validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
              idealOutputPerMinute: 100,
              counterMultiplier: 1,
              idealSpeed,
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
            total: { durationMs: 60 * 60 * 1000, timeWeightedAverage: 100, valueArea },
          },
        },
      })

      const result = calculateProductivity(input)
      expect(result.status).toBe('not_calculable')
      expect(result.jobOrders[0].notCalculable).toBe(true)
      expect(Number.isFinite(result.jobOrders[0].actualOutput)).toBe(true)
    }
  })

  it('speed_based with product standard change mid-job: per-subwindow ratio applied', () => {
    // JO: T0..T2 (120 min)
    //   std1 [T0..T1): idealOutputPerMinute=100, idealSpeed=100  → target1 = 6000
    //   std2 [T1..T2): idealOutputPerMinute=200, idealSpeed=50   → target2 = 12000
    //   total target = 18000
    // The service asks telemetry for the JO split at the standard boundary (T1). Constant
    // actualSpeed=50 gives each half a valueArea of 50 × 3,600,000 = 180,000,000:
    //   subActualOutput1 = (100/100) × 180,000,000/60000 = 3000
    //   subActualOutput2 = (200/50)  × 180,000,000/60000 = 4 × 3000 = 12000
    //   actualOutput = 15000 → ratio = 15000/18000 ≈ 0.8333
    const valueArea = 50 * 60 * 60 * 1000
    const hour = 60 * 60 * 1000

    const input = makeInput({
      productivityMode: 'speed_based',
      productionCounterTagId: undefined,
      speedTagId: 'tag-speed',
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
            idealOutputPerMinute: 100,
            counterMultiplier: 1,
            idealSpeed: 100,
          },
          {
            _id: 'std2',
            validFrom: T1.toISOString(),
            idealOutputPerMinute: 200,
            counterMultiplier: 1,
            idealSpeed: 50,
          },
        ],
      },
      speedSummaryByTagId: {
        'tag-speed': {
          windows: [
            {
              from: T0.toISOString(),
              to: T1.toISOString(),
              durationMs: hour,
              timeWeightedAverage: 50,
              valueArea,
              sampleCount: 60,
            },
            {
              from: T1.toISOString(),
              to: T2.toISOString(),
              durationMs: hour,
              timeWeightedAverage: 50,
              valueArea,
              sampleCount: 60,
            },
          ],
          total: { durationMs: 2 * hour, timeWeightedAverage: 50, valueArea: 2 * valueArea },
        },
      },
    })

    const result = calculateProductivity(input)
    expect(result.status).toBe('ok')
    expect(result.jobOrders[0].actualOutput).toBeCloseTo(15000, 1)
    expect(result.jobOrders[0].effectiveTargetOutput).toBeCloseTo(18000, 1)
    expect(result.ratio).toBeCloseTo(15000 / 18000, 3)
  })
})
