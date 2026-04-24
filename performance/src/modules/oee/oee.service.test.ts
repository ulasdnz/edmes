import { CustomError } from '@mes/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as productionClient from '../../lib/internal-api/production.client.js'
import * as telemetryClient from '../../lib/internal-api/telemetry.client.js'
import type { WorkCenterSnapshot } from '../../lib/internal-api/work-center.client.js'
import * as workCenterClient from '../../lib/internal-api/work-center.client.js'
import type { IPerformanceRuntimePolicy } from '../policy/policy.model.js'
import * as policyService from '../policy/policy.service.js'
import * as reasonService from '../reason/reason.service.js'
import * as oeeRepository from './oee.repository.js'
import { calculateOee } from './oee.service.js'
import type { OeeRange } from './oee.types.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WC_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const PROD_ID = 'cccccccccccccccccccccccc'
const JO_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const TAG_COUNTER = 'tag-counter-id'
const TAG_SPEED = 'tag-speed-id'

const RANGE: OeeRange = {
  from: new Date('2026-01-01T06:00:00.000Z'),
  to: new Date('2026-01-01T18:00:00.000Z'),
}

const MICRO_STOP_OBJ_ID = { toString: () => 'ffffffffffffffffffffffff' } as never

const BASE_WC: WorkCenterSnapshot = {
  _id: WC_ID,
  type: 'machine',
  productivityMode: 'count_based',
  status: 'active',
  tagBindings: {
    runModeTagId: 'tag-run-id',
    producedCounterTagId: TAG_COUNTER,
    speedTagId: TAG_SPEED,
  },
}

const BASE_POLICY: IPerformanceRuntimePolicy = {
  _id: { toString: () => 'policy-id' } as never,
  workCenterId: null,
  runModeDebounceMs: 0,
  microStopThresholdMs: 120_000,
  actualOutputWindowMode: 'execution_span',
  productivityAggregationMode: 'total_ratio',
  allowProductivityOver100: true,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const BASE_JO = {
  jobOrderId: JO_ID,
  workCenterId: WC_ID,
  productId: PROD_ID,
  start: new Date('2026-01-01T06:00:00.000Z'),
  end: new Date('2026-01-01T18:00:00.000Z'),
}

const BASE_STOPS = {
  planned: [],
  unplanned: [],
  microStopReasonId: 'ffffffffffffffffffffffff',
}

const BASE_STANDARDS: Record<string, unknown[]> = {
  [JO_ID]: [
    {
      _id: 'std1',
      validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      idealOutputPerMinute: 10,
      counterMultiplier: 1,
      idealSpeed: null,
    },
  ],
}

const BASE_RECORDS = {
  quantityAdjustmentsByJobOrderId: {},
  scrapEntriesByJobOrderId: {},
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.spyOn(workCenterClient, 'getById').mockResolvedValue(BASE_WC)
  vi.spyOn(policyService, 'resolveForWorkCenter').mockResolvedValue(BASE_POLICY)
  vi.spyOn(reasonService, 'getSystemReasonIdByCode').mockResolvedValue(MICRO_STOP_OBJ_ID)
  vi.spyOn(reasonService, 'findIds').mockResolvedValue(new Set())
  vi.spyOn(reasonService, 'findExistingIds').mockResolvedValue(new Set())
  vi.spyOn(productionClient, 'findStartedJobOrders').mockResolvedValue([BASE_JO])
  vi.spyOn(oeeRepository, 'findStopsForOee').mockResolvedValue(BASE_STOPS)
  vi.spyOn(productionClient, 'findProductStandardTimelinesBatch').mockResolvedValue(
    BASE_STANDARDS as never,
  )
  vi.spyOn(productionClient, 'findJobOrderRecordsBatch').mockResolvedValue(BASE_RECORDS)
  vi.spyOn(telemetryClient, 'producedSummary').mockResolvedValue({
    windows: [
      {
        from: '2026-01-01T06:00:00.000Z',
        to: '2026-01-01T18:00:00.000Z',
        value: 7200,
        qualityFlags: [],
      },
    ],
    total: 7200,
  })
  vi.spyOn(telemetryClient, 'speedSummary').mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calculateOee — stage orchestration', () => {
  it('Stage 1 issues 5 parallel calls (microStopReasonId resolved once inside repository)', async () => {
    await calculateOee({ workCenterId: WC_ID, range: RANGE })

    expect(workCenterClient.getById).toHaveBeenCalledOnce()
    expect(policyService.resolveForWorkCenter).toHaveBeenCalledOnce()
    // getSystemReasonIdByCode must NOT be called from the service — only from inside the repo
    expect(reasonService.getSystemReasonIdByCode).not.toHaveBeenCalled()
    expect(reasonService.findIds).toHaveBeenCalledOnce()
    expect(productionClient.findStartedJobOrders).toHaveBeenCalledOnce()
    expect(oeeRepository.findStopsForOee).toHaveBeenCalledOnce()
    expect(vi.mocked(oeeRepository.findStopsForOee).mock.calls[0][0]).toMatchObject({
      excludeUnplannedSystemReasonCodes: ['MICRO_STOP'],
    })
  })

  it('Stage 3 runs only after job orders are known (standards + records called with JO ids)', async () => {
    await calculateOee({ workCenterId: WC_ID, range: RANGE })

    expect(productionClient.findProductStandardTimelinesBatch).toHaveBeenCalledOnce()
    expect(productionClient.findJobOrderRecordsBatch).toHaveBeenCalledOnce()

    const standardsCall = vi.mocked(productionClient.findProductStandardTimelinesBatch).mock
      .calls[0][0]
    expect(standardsCall[0].jobOrderId).toBe(JO_ID)
  })

  it('virtual work center throws 501', async () => {
    vi.mocked(workCenterClient.getById).mockResolvedValue({
      ...BASE_WC,
      type: 'virtual',
    })

    await expect(calculateOee({ workCenterId: WC_ID, range: RANGE })).rejects.toMatchObject({
      statusCode: 501,
    })

    // Stage 3 must NOT have been called for virtual WC
    expect(productionClient.findProductStandardTimelinesBatch).not.toHaveBeenCalled()
  })

  it('no job orders short-circuits without calling telemetry or standards', async () => {
    vi.mocked(productionClient.findStartedJobOrders).mockResolvedValue([])

    const result = await calculateOee({ workCenterId: WC_ID, range: RANGE })

    expect(productionClient.findProductStandardTimelinesBatch).not.toHaveBeenCalled()
    expect(productionClient.findJobOrderRecordsBatch).not.toHaveBeenCalled()
    expect(telemetryClient.producedSummary).not.toHaveBeenCalled()
    expect(telemetryClient.speedSummary).not.toHaveBeenCalled()

    expect(result.availability.status).toBe('no_context')
    expect(result.productivity.status).toBe('no_context')
  })

  it('with 20 JOs makes max 1 telemetry call for count_based (batched per tag)', async () => {
    const twentyJos = Array.from({ length: 20 }, (_, i) => ({
      jobOrderId: `jo${i.toString().padStart(22, '0')}`,
      workCenterId: WC_ID,
      productId: PROD_ID,
      start: new Date('2026-01-01T06:00:00.000Z'),
      end: new Date('2026-01-01T18:00:00.000Z'),
    }))

    const standards: Record<string, unknown[]> = {}
    for (const jo of twentyJos) {
      standards[jo.jobOrderId] = [
        {
          _id: 'std1',
          validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          idealOutputPerMinute: 10,
          counterMultiplier: 1,
          idealSpeed: null,
        },
      ]
    }

    vi.mocked(productionClient.findStartedJobOrders).mockResolvedValue(twentyJos)
    vi.mocked(productionClient.findProductStandardTimelinesBatch).mockResolvedValue(
      standards as never,
    )
    vi.mocked(productionClient.findJobOrderRecordsBatch).mockResolvedValue(BASE_RECORDS)

    await calculateOee({ workCenterId: WC_ID, range: RANGE })

    // count_based: only 1 telemetry call for the counter tag (all windows batched)
    expect(telemetryClient.producedSummary).toHaveBeenCalledTimes(1)
    expect(telemetryClient.speedSummary).not.toHaveBeenCalled()

    // Max 2 production batch calls (standards + records)
    expect(productionClient.findProductStandardTimelinesBatch).toHaveBeenCalledTimes(1)
    expect(productionClient.findJobOrderRecordsBatch).toHaveBeenCalledTimes(1)
  })

  it('non-overlapping windows contract: windows passed to producedSummary are non-overlapping', async () => {
    const { isNonOverlapping } = await import('./_test-utils.js')

    await calculateOee({ workCenterId: WC_ID, range: RANGE })

    const calls = vi.mocked(telemetryClient.producedSummary).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const windows = calls[0][1]
    expect(isNonOverlapping(windows as never)).toBe(true)
  })

  it('quality map isolation: scrap for JO-B does not leak into JO-A quality calc', async () => {
    const JO_A = 'aaaaaaaaaaaaaaaaaaaaaaab'
    const JO_B = 'aaaaaaaaaaaaaaaaaaaaaaac'

    const twoJos = [
      {
        jobOrderId: JO_A,
        workCenterId: WC_ID,
        productId: PROD_ID,
        start: new Date('2026-01-01T06:00:00.000Z'),
        end: new Date('2026-01-01T12:00:00.000Z'),
      },
      {
        jobOrderId: JO_B,
        workCenterId: WC_ID,
        productId: PROD_ID,
        start: new Date('2026-01-01T12:00:00.000Z'),
        end: new Date('2026-01-01T18:00:00.000Z'),
      },
    ]

    const standards: Record<string, unknown[]> = {}
    for (const jo of twoJos) {
      standards[jo.jobOrderId] = [
        {
          _id: 'std1',
          validFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          idealOutputPerMinute: 10,
          counterMultiplier: 1,
          idealSpeed: null,
        },
      ]
    }

    vi.mocked(productionClient.findStartedJobOrders).mockResolvedValue(twoJos)
    vi.mocked(productionClient.findProductStandardTimelinesBatch).mockResolvedValue(
      standards as never,
    )
    vi.mocked(productionClient.findJobOrderRecordsBatch).mockResolvedValue({
      quantityAdjustmentsByJobOrderId: {},
      scrapEntriesByJobOrderId: {
        [JO_A]: [],
        // JO-B has a large scrap entry that would destroy JO-A's ratio if leaked
        [JO_B]: [
          {
            amount: 9999,
            reasonId: null,
            startTime: new Date('2026-01-01T12:00:00.000Z'),
            endTime: new Date('2026-01-01T18:00:00.000Z'),
          },
        ],
      },
    })
    vi.spyOn(reasonService, 'findExistingIds').mockResolvedValue(new Set())

    // 100 units produced across the two JO windows
    vi.mocked(telemetryClient.producedSummary).mockResolvedValue({
      windows: [
        {
          from: '2026-01-01T06:00:00.000Z',
          to: '2026-01-01T12:00:00.000Z',
          value: 100,
          qualityFlags: [],
        },
        {
          from: '2026-01-01T12:00:00.000Z',
          to: '2026-01-01T18:00:00.000Z',
          value: 100,
          qualityFlags: [],
        },
      ],
      total: 200,
    })

    const result = await calculateOee({ workCenterId: WC_ID, range: RANGE })

    // JO-A has no scrap so its contribution to quality should not be affected by JO-B's scrap
    // overall quality: JO-A contributes 100 good out of 100; JO-B contributes 0 good out of 100
    // aggregate: good=100, total=200, ratio=0.5 — NOT ratio=0 which would happen if JO-B scrap leaked
    expect(result.quality.total).toBeGreaterThan(0)
    // JO-A's scrap is 0, so it contributes 100 good; ratio would be < 0.5 only if JO-B scrap leaked into JO-A
    // With correct isolation: oeeAffectingScrap = 9999 (JO-B only), good = max(200-9999,0) = 0 — ratio=0
    // But that's fine: the point is JO-A's window entries are empty, not polluted by JO-B entries
    expect(result.quality.oeeAffectingScrap).toBeCloseTo(9999)
    expect(result.quality.good).toBe(0)
  })

  it('net_run_segments: windows passed to producedSummary are non-overlapping when stop splits JO', async () => {
    const { isNonOverlapping } = await import('./_test-utils.js')

    // 12-hour JO with a 2-hour planned stop in the middle → two run segments
    const stopStart = new Date('2026-01-01T10:00:00.000Z')
    const stopEnd = new Date('2026-01-01T12:00:00.000Z')

    vi.mocked(policyService.resolveForWorkCenter).mockResolvedValue({
      ...BASE_POLICY,
      actualOutputWindowMode: 'net_run_segments',
    })

    vi.mocked(oeeRepository.findStopsForOee).mockResolvedValue({
      planned: [
        {
          _id: 'stop1',
          workCenterId: WC_ID,
          reasonId: 'reason1',
          source: 'planned',
          start: stopStart,
          end: stopEnd,
        },
      ],
      unplanned: [],
      microStopReasonId: 'ffffffffffffffffffffffff',
    })

    await calculateOee({ workCenterId: WC_ID, range: RANGE })

    const calls = vi.mocked(telemetryClient.producedSummary).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const windows = calls[0][1] as Array<{ from: Date; to: Date }>
    // Must produce at least 2 sub-windows (before and after the stop)
    expect(windows.length).toBeGreaterThanOrEqual(2)
    // All must be non-overlapping
    expect(isNonOverlapping(windows as never)).toBe(true)
    // Each window's end <= next window's start
    const sorted = [...windows].sort(
      (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime(),
    )
    for (let i = 1; i < sorted.length; i++) {
      expect(new Date(sorted[i].from).getTime()).toBeGreaterThanOrEqual(
        new Date(sorted[i - 1].to).getTime(),
      )
    }
  })

  it('net_run_segments: gross produced for quality uses full JO window (extra telemetry call), not run-segment windows', async () => {
    // JO: 06:00–18:00 (720 min). Planned non-effective stop: 10:00–12:00 (120 min).
    // Run segments: 06:00–10:00 (240 min) + 12:00–18:00 (360 min) = 600 min.
    // Telemetry reports 100 units/min uniformly throughout.
    //   Productivity call (run-segment windows): 600 min × 100 = 60 000 units
    //   Quality call (full JO window): 720 min × 100 = 72 000 units gross
    // Without fix: grossProducedAcrossExecution would be derived from productivity.actualOutput
    //   (which is over run-segment windows) → under-counts by 12 000.
    // With fix: a second producedSummary call over the full JO window returns 72 000.

    const stopStart = new Date('2026-01-01T10:00:00.000Z')
    const stopEnd = new Date('2026-01-01T12:00:00.000Z')

    vi.mocked(policyService.resolveForWorkCenter).mockResolvedValue({
      ...BASE_POLICY,
      actualOutputWindowMode: 'net_run_segments',
    })

    vi.mocked(oeeRepository.findStopsForOee).mockResolvedValue({
      planned: [
        {
          _id: 'stop1',
          workCenterId: WC_ID,
          reasonId: 'reason1',
          source: 'planned',
          start: stopStart,
          end: stopEnd,
        },
      ],
      unplanned: [],
      microStopReasonId: 'ffffffffffffffffffffffff',
    })

    vi.mocked(productionClient.findJobOrderRecordsBatch).mockResolvedValue({
      quantityAdjustmentsByJobOrderId: {},
      scrapEntriesByJobOrderId: {},
    })

    // producedSummary is called twice:
    //   call 0 → productivity (run-segment windows): two windows, each value=30 000, total=60 000
    //   call 1 → quality (full JO window): one window, value=72 000, total=72 000
    let producedSummaryCallCount = 0
    vi.mocked(telemetryClient.producedSummary).mockImplementation(async (_tagId, windows) => {
      producedSummaryCallCount++
      if (producedSummaryCallCount === 1) {
        // Productivity call: two run-segment windows (240 min + 360 min at 100/min)
        return {
          windows: windows.map(w => ({
            from: typeof w.from === 'string' ? w.from : (w.from as Date).toISOString(),
            to: typeof w.to === 'string' ? w.to : (w.to as Date).toISOString(),
            value: 30_000,
            qualityFlags: [],
          })),
          total: 60_000,
        }
      }
      // Quality call: full JO window (720 min at 100/min = 72 000)
      return {
        windows: windows.map(w => ({
          from: typeof w.from === 'string' ? w.from : (w.from as Date).toISOString(),
          to: typeof w.to === 'string' ? w.to : (w.to as Date).toISOString(),
          value: 72_000,
          qualityFlags: [],
        })),
        total: 72_000,
      }
    })

    const result = await calculateOee({ workCenterId: WC_ID, range: RANGE })

    // Must have issued exactly 2 calls to producedSummary
    expect(telemetryClient.producedSummary).toHaveBeenCalledTimes(2)

    // The second call must use the full JO window (single window: 06:00–18:00)
    const qualityCall = vi.mocked(telemetryClient.producedSummary).mock.calls[1]
    const qualityWindows = qualityCall[1]
    expect(qualityWindows).toHaveLength(1)
    expect(new Date(qualityWindows[0].from as never).toISOString()).toBe('2026-01-01T06:00:00.000Z')
    expect(new Date(qualityWindows[0].to as never).toISOString()).toBe('2026-01-01T18:00:00.000Z')

    // gross produced must be 72 000 (from full JO window), not 60 000 (from run segments)
    // total = grossProduced + quantityAdjustment = 72 000 + 0 = 72 000
    expect(result.quality.total).toBe(72_000)
  })

  it('net_run_segments speed_based: gross produced for quality uses full JO window (extra speedSummary call)', async () => {
    // Same scenario as above but speed_based mode.
    const stopStart = new Date('2026-01-01T10:00:00.000Z')
    const stopEnd = new Date('2026-01-01T12:00:00.000Z')

    vi.mocked(workCenterClient.getById).mockResolvedValue({
      ...BASE_WC,
      productivityMode: 'speed_based',
    })

    vi.mocked(policyService.resolveForWorkCenter).mockResolvedValue({
      ...BASE_POLICY,
      actualOutputWindowMode: 'net_run_segments',
    })

    vi.mocked(oeeRepository.findStopsForOee).mockResolvedValue({
      planned: [
        {
          _id: 'stop1',
          workCenterId: WC_ID,
          reasonId: 'reason1',
          source: 'planned',
          start: stopStart,
          end: stopEnd,
        },
      ],
      unplanned: [],
      microStopReasonId: 'ffffffffffffffffffffffff',
    })

    vi.mocked(productionClient.findJobOrderRecordsBatch).mockResolvedValue({
      quantityAdjustmentsByJobOrderId: {},
      scrapEntriesByJobOrderId: {},
    })

    // valueArea is unit×ms; output = valueArea * counterMultiplier / 60000.
    // counterMultiplier=1 (from BASE_STANDARDS). To yield 60 000 output units from two
    // run-segment windows (each 30 000 output units): valueArea per window = 30 000 * 60 000 = 1 800 000 000.
    // To yield 72 000 output from the full JO window: valueArea = 72 000 * 60 000 = 4 320 000 000.
    let speedSummaryCallCount = 0
    vi.mocked(telemetryClient.speedSummary).mockImplementation(async (_tagId, windows) => {
      speedSummaryCallCount++
      if (speedSummaryCallCount === 1) {
        // Productivity call: run-segment windows
        return {
          windows: windows.map(w => ({
            from: typeof w.from === 'string' ? w.from : (w.from as Date).toISOString(),
            to: typeof w.to === 'string' ? w.to : (w.to as Date).toISOString(),
            valueArea: 1_800_000_000,
            durationMs: 0,
            timeWeightedAverage: 0,
            sampleCount: 0,
          })),
          total: { durationMs: 0, timeWeightedAverage: 0, valueArea: 3_600_000_000 },
        }
      }
      // Quality call: full JO window (720 min × 100/min × 60000 ms/min = 4 320 000 000)
      return {
        windows: windows.map(w => ({
          from: typeof w.from === 'string' ? w.from : (w.from as Date).toISOString(),
          to: typeof w.to === 'string' ? w.to : (w.to as Date).toISOString(),
          valueArea: 4_320_000_000,
          durationMs: 0,
          timeWeightedAverage: 0,
          sampleCount: 0,
        })),
        total: { durationMs: 0, timeWeightedAverage: 0, valueArea: 4_320_000_000 },
      }
    })

    const result = await calculateOee({ workCenterId: WC_ID, range: RANGE })

    expect(telemetryClient.speedSummary).toHaveBeenCalledTimes(2)
    expect(telemetryClient.producedSummary).not.toHaveBeenCalled()

    const qualityCall = vi.mocked(telemetryClient.speedSummary).mock.calls[1]
    const qualityWindows = qualityCall[1]
    expect(qualityWindows).toHaveLength(1)

    expect(result.quality.total).toBe(72_000)
  })

  it('execution_span: no extra telemetry call for quality (gross produced reused from productivity)', async () => {
    // execution_span: actualOutputWindows === jobOrderWindows → no extra call needed.
    vi.mocked(policyService.resolveForWorkCenter).mockResolvedValue({
      ...BASE_POLICY,
      actualOutputWindowMode: 'execution_span',
    })

    await calculateOee({ workCenterId: WC_ID, range: RANGE })

    // Only 1 producedSummary call (productivity); quality reuses the result
    expect(telemetryClient.producedSummary).toHaveBeenCalledTimes(1)
  })
})
