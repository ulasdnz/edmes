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
  it('Stage 1 issues 6 parallel calls', async () => {
    await calculateOee({ workCenterId: WC_ID, range: RANGE })

    expect(workCenterClient.getById).toHaveBeenCalledOnce()
    expect(policyService.resolveForWorkCenter).toHaveBeenCalledOnce()
    expect(reasonService.getSystemReasonIdByCode).toHaveBeenCalledOnce()
    expect(reasonService.findIds).toHaveBeenCalledOnce()
    expect(productionClient.findStartedJobOrders).toHaveBeenCalledOnce()
    expect(oeeRepository.findStopsForOee).toHaveBeenCalledOnce()
    expect(vi.mocked(oeeRepository.findStopsForOee).mock.calls[0][0]).toMatchObject({
      excludeSystemReasonCodes: ['MICRO_STOP'],
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
    const { isNonOverlapping } = await import('./productivity.calc.js')

    await calculateOee({ workCenterId: WC_ID, range: RANGE })

    const calls = vi.mocked(telemetryClient.producedSummary).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const windows = calls[0][1]
    expect(isNonOverlapping(windows as never)).toBe(true)
  })

  it('net_run_segments: windows passed to producedSummary are non-overlapping when stop splits JO', async () => {
    const { isNonOverlapping } = await import('./productivity.calc.js')

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
})
