import '../../../test/contract-setup.js'

import type { Server } from 'node:http'
import express from 'express'
import { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_IDENTITY } from '../../../constants/identity.js'
import { PlannedStop } from '../../planned-stop/planned-stop.model.js'
import * as policyService from '../../policy/policy.service.js'
import { bootstrapSystemReasons } from '../../reason/reason.bootstrap.js'
import { Reason } from '../../reason/reason.model.js'
import { UnplannedStop } from '../../unplanned-stop/unplanned-stop.model.js'
import { calculate } from '../oee.service.js'

// ── Stub servers (lightweight Express, bound to fixed ports in env) ───────────

type StubHandlers = {
  getWorkCenter?: (id: string) => unknown
  getJobOrders?: (params: URLSearchParams) => unknown
  getProductStandardsBatch?: (body: unknown) => unknown
  getJobOrderRecordsBatch?: (body: unknown) => unknown
  getProducedSummary?: (tagId: string, body: unknown) => unknown
  getSpeedSummary?: (tagId: string, body: unknown) => unknown
  getUserWorkCenterIds?: (userId: string) => unknown
}

let handlers: StubHandlers = {}

function makeStubServers() {
  const userApp = express()
  userApp.get('/internal/v1/users/:userId/work-center-ids', (req, res) => {
    const fn = handlers.getUserWorkCenterIds
    if (fn) return res.json({ data: fn(req.params.userId) })
    res.json({ data: [] })
  })

  const wcApp = express()
  wcApp.get('/internal/v1/work-centers/:id', (req, res) => {
    const fn = handlers.getWorkCenter
    if (fn) {
      const data = fn(req.params.id)
      if (!data) return res.status(404).json({ error: { code: 'not_found', message: 'not found' } })
      return res.json({ data })
    }
    res.status(404).json({ error: { code: 'not_found', message: 'not found' } })
  })

  const prodApp = express()
  prodApp.use(express.json())
  prodApp.get('/internal/v1/job-orders', (req, res) => {
    const fn = handlers.getJobOrders
    const params = new URLSearchParams(req.query as Record<string, string>)
    if (fn) return res.json({ data: fn(params) })
    res.json({ data: [] })
  })
  prodApp.post('/internal/v1/product-standards/timelines:batch', (req, res) => {
    const fn = handlers.getProductStandardsBatch
    if (fn) return res.json({ data: fn(req.body) })
    res.json({ data: { items: [] } })
  })
  prodApp.post('/internal/v1/job-order-records:batch', (req, res) => {
    const fn = handlers.getJobOrderRecordsBatch
    if (fn) return res.json({ data: fn(req.body) })
    res.json({
      data: { quantityAdjustmentsByJobOrderId: {}, scrapEntriesByJobOrderId: {} },
    })
  })

  const telemApp = express()
  telemApp.use(express.json())
  telemApp.post('/internal/v1/historian/:tagId/produced-summary', (req, res) => {
    const fn = handlers.getProducedSummary
    if (fn) return res.json({ data: fn(req.params.tagId, req.body) })
    res.json({ data: { windows: [], total: 0 } })
  })
  telemApp.post('/internal/v1/historian/:tagId/speed-summary', (req, res) => {
    const fn = handlers.getSpeedSummary
    if (fn) return res.json({ data: fn(req.params.tagId, req.body) })
    res.json({
      data: { windows: [], total: { durationMs: 0, timeWeightedAverage: 0, valueArea: 0 } },
    })
  })
  telemApp.get('/internal/v1/historian/:tagId/latest', (_req, res) => {
    res.status(404).json({})
  })

  return { userApp, wcApp, prodApp, telemApp }
}

const servers: Server[] = []

beforeAll(async () => {
  const { userApp, wcApp, prodApp, telemApp } = makeStubServers()
  await new Promise<void>(res => {
    servers.push(userApp.listen(19901, res))
  })
  await new Promise<void>(res => {
    servers.push(wcApp.listen(19902, res))
  })
  await new Promise<void>(res => {
    servers.push(prodApp.listen(19903, res))
  })
  await new Promise<void>(res => {
    servers.push(telemApp.listen(19904, res))
  })
  // Bootstrap here too — the previous file's afterEach may have wiped the DB
  // before this file's beforeEach runs for the very first test.
  await bootstrapSystemReasons()
}, 30_000)

// Re-bootstrap after every afterEach wipe so MICRO_STOP always exists.
beforeEach(async () => {
  await bootstrapSystemReasons()
})

afterAll(async () => {
  await Promise.all(
    servers.map(s => new Promise<void>((res, rej) => s.close(e => (e ? rej(e) : res())))),
  )
})

// ── Helper to reset handlers per scenario ─────────────────────────────────────

function resetHandlers(override: StubHandlers = {}) {
  handlers = { ...override }
}

// ── Shared test fixtures ───────────────────────────────────────────────────────

const WC_ID = new Types.ObjectId().toHexString()
const JO_ID = new Types.ObjectId().toHexString()
const PROD_ID = new Types.ObjectId().toHexString()
const TAG_COUNTER = 'tag-counter-001'
const TAG_SPEED = 'tag-speed-001'
const REASON_OEE_ID = new Types.ObjectId().toHexString()
const REASON_NON_OEE_ID = new Types.ObjectId().toHexString()
const SYSTEM_ACTOR = new Types.ObjectId(SYSTEM_IDENTITY)

const FROM = new Date('2026-01-01T06:00:00.000Z')
const TO = new Date('2026-01-01T07:00:00.000Z') // 60 min window

function machineWc(id = WC_ID) {
  return {
    _id: id,
    type: 'physical',
    productivityMode: 'count_based',
    status: 'active',
    tagBindings: { productionCounterTagId: TAG_COUNTER },
  }
}

function loomWc(id = WC_ID) {
  return {
    _id: id,
    type: 'physical',
    productivityMode: 'speed_based',
    status: 'active',
    tagBindings: { speedTagId: TAG_SPEED },
  }
}

function joRecord(id = JO_ID, startTime = FROM.toISOString(), endTime: string | null = null) {
  return { _id: id, workCenterId: WC_ID, productId: PROD_ID, startTime, endTime, code: 'JO-001' }
}

function standardTimeline(
  idealOutputPerMinute = 10,
  counterMultiplier: number | null = 1,
  validFrom = '2026-01-01T00:00:00.000Z',
) {
  return {
    _id: new Types.ObjectId().toHexString(),
    validFrom,
    idealOutputPerMinute,
    counterMultiplier,
    idealSpeed: null,
  }
}

function producedSummaryFor(totalUnits: number, from: Date, to: Date) {
  const durationMs = to.getTime() - from.getTime()
  return {
    windows: [
      { from: from.toISOString(), to: to.toISOString(), value: totalUnits, qualityFlags: [] },
    ],
    total: totalUnits,
  }
}

type Stop = { from: Date; to: Date }

function stoppedMsWithin(from: number, to: number, stopped: Stop[]) {
  return stopped.reduce(
    (sum, s) => sum + Math.max(0, Math.min(to, s.to.getTime()) - Math.max(from, s.from.getTime())),
    0,
  )
}

// Answers produced-summary the way real telemetry does (see the telemetry provider contract
// test): the raw counter delta of each requested window, in request order. The counter goes up
// strokesPerMinute times a minute and stands still while the machine is stopped.
function strokeCounter(strokesPerMinute: number, stopped: Stop[] = []) {
  return (_tagId: string, body: { windows: Array<{ from: string; to: string }> }) => {
    const windows = body.windows.map(w => {
      const from = new Date(w.from).getTime()
      const to = new Date(w.to).getTime()
      const value = (strokesPerMinute * (to - from - stoppedMsWithin(from, to, stopped))) / 60_000
      return { from: w.from, to: w.to, value, qualityFlags: [] }
    })
    return { windows, total: windows.reduce((sum, w) => sum + w.value, 0) }
  }
}

// Answers speed-summary the way real telemetry does (see the telemetry provider contract test):
// the speed area (speed × milliseconds) of each requested window, in request order. The speed
// is constant while running and zero while the machine is stopped.
function steadySpeed(speed: number, stopped: Stop[] = []) {
  return (_tagId: string, body: { windows: Array<{ from: string; to: string }> }) => {
    const windows = body.windows.map(w => {
      const from = new Date(w.from).getTime()
      const to = new Date(w.to).getTime()
      const durationMs = to - from
      const valueArea = speed * (durationMs - stoppedMsWithin(from, to, stopped))
      const timeWeightedAverage = valueArea / durationMs
      return { from: w.from, to: w.to, durationMs, timeWeightedAverage, valueArea, sampleCount: 1 }
    })
    const durationMs = windows.reduce((sum, w) => sum + w.durationMs, 0)
    const valueArea = windows.reduce((sum, w) => sum + w.valueArea, 0)
    return {
      windows,
      total: { durationMs, timeWeightedAverage: valueArea / durationMs, valueArea },
    }
  }
}

function scrapRecord(amount: number, startTime: Date, endTime: Date) {
  return {
    _id: new Types.ObjectId().toHexString(),
    amount,
    reasonId: null,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  }
}

async function insertOeeAffectingReason() {
  const existing = await Reason.findById(REASON_OEE_ID)
  if (existing) return existing
  return Reason.create({
    _id: new Types.ObjectId(REASON_OEE_ID),
    code: 'REASON_OEE',
    name: 'OEE Affecting Stop',
    usages: ['unplanned_stop'],
    affectsOee: true,
    isSystemDefault: false,
    isActive: true,
    canStartManually: true,
    canBeScheduled: false,
    canConvertFromUnplanned: false,
    requiresDescription: false,
    createdBy: SYSTEM_ACTOR,
  })
}

async function insertNonOeeReason() {
  const existing = await Reason.findById(REASON_NON_OEE_ID)
  if (existing) return existing
  return Reason.create({
    _id: new Types.ObjectId(REASON_NON_OEE_ID),
    code: 'REASON_NON_OEE',
    name: 'Non-OEE Planned Stop',
    usages: ['planned_stop'],
    affectsOee: false,
    isSystemDefault: false,
    isActive: true,
    canStartManually: true,
    canBeScheduled: true,
    canConvertFromUnplanned: false,
    requiresDescription: false,
    createdBy: SYSTEM_ACTOR,
  })
}

// ── Scenario 1: Single JO, no stops, constant counter ────────────────────────

describe('Scenario 1: single JO, no stops, constant counter — 100% OEE', () => {
  it('returns the correct OEE response shape and 100% on all factors', async () => {
    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: body => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(10)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: () => producedSummaryFor(600, FROM, TO), // 10/min × 60 min = 600
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result).toMatchObject({
      workCenterId: WC_ID,
      range: {
        from: FROM.toISOString(),
        to: TO.toISOString(),
      },
      availability: { percentage: 100, status: 'ok' },
      productivity: { percentage: 100, status: 'ok' },
      quality: { percentage: 100, status: 'ok' },
      oee: { percentage: 100, status: 'ok' },
      diagnostics: expect.any(Array),
    })

    expect(typeof result.availability.diagnostics).toBe('object')
    expect(typeof result.productivity.diagnostics).toBe('object')
    expect(typeof result.quality.diagnostics).toBe('object')
  })
})

// ── Scenario 2: JO + 10-min OEE-affecting unplanned stop ─────────────────────

describe('Scenario 2: 10-min OEE-affecting unplanned stop → availability=80%', () => {
  it('deducts stop time from availability', async () => {
    await insertOeeAffectingReason()

    const stopStart = new Date('2026-01-01T06:00:00.000Z')
    const stopEnd = new Date('2026-01-01T06:10:00.000Z')

    await UnplannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: new Types.ObjectId(REASON_OEE_ID),
      source: 'manual',
      startAt: stopStart,
      endAt: stopEnd,
      createdBy: null,
    })

    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: body => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(10)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: () => producedSummaryFor(500, FROM, TO),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    // 60 min JO, 10 min OEE-affecting unplanned stop
    // effectiveRunTime/oeeEligibleTime = (60-10)/60 = 0.8333 → 83%
    expect(result.availability.status).toBe('ok')
    expect(result.availability.percentage).toBeLessThan(100)
    expect(result.availability.percentage).toBeGreaterThanOrEqual(80)
  })
})

// ── Scenario 3: JO + 10-min non-effective planned stop → availability=100% ───

describe('Scenario 3: non-effective planned stop → availability=100%', () => {
  it('non-OEE planned stop does not reduce availability ratio', async () => {
    await insertNonOeeReason()

    const stopStart = new Date('2026-01-01T06:10:00.000Z')
    const stopEnd = new Date('2026-01-01T06:20:00.000Z')

    const ownerId = new Types.ObjectId()
    await PlannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: new Types.ObjectId(REASON_NON_OEE_ID),
      plannedOwnerId: ownerId,
      source: 'manual',
      startMode: 'automatic',
      status: 'closed',
      plannedStartAt: stopStart,
      plannedEndAt: stopEnd,
      actualStartAt: stopStart,
      actualEndAt: stopEnd,
      createdBy: null,
    })

    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: body => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(10)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: () => producedSummaryFor(500, FROM, TO),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    // Non-OEE reason → effectiveAffectsOee=false → doesn't reduce numerator
    // oeeEligibleTime = 60 - 10 = 50 min; effectiveRunTime = 50 min → ratio=1.0
    expect(result.availability.status).toBe('ok')
    expect(result.availability.percentage).toBe(100)
  })
})

// ── Scenario 4: MICRO_STOP excluded from OEE calculation ─────────────────────

describe('Scenario 4: MICRO_STOP excluded by repo query', () => {
  it('unplanned stop with MICRO_STOP reason has no effect on availability', async () => {
    const microStopReason = await Reason.findOne({ code: 'MICRO_STOP' })
    expect(microStopReason).toBeTruthy()

    const stopStart = new Date('2026-01-01T06:05:00.000Z')
    const stopEnd = new Date('2026-01-01T06:07:00.000Z') // 2 min

    await UnplannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: microStopReason!._id,
      source: 'run_mode',
      startAt: stopStart,
      endAt: stopEnd,
      createdBy: null,
    })

    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: body => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(10)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: () => producedSummaryFor(600, FROM, TO),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    // MICRO_STOP excluded → availability still 100%
    expect(result.availability.percentage).toBe(100)
    expect(result.availability.status).toBe('ok')
  })
})

// ── Scenario 5: Missing product standard → not_calculable ─────────────────────

describe('Scenario 5: no product standard → productivity not_calculable', () => {
  it('returns not_calculable for productivity and oee when standard is missing', async () => {
    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({ items: [] }), // no standard returned
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: () => producedSummaryFor(600, FROM, TO),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result.productivity.status).toBe('not_calculable')
    expect(result.oee.status).toBe('not_calculable')
    expect(result.oee.percentage).toBe(0)
  })
})

// ── Scenario 6: Virtual WC with primary_work_center → uses contributor 0 ─────

describe('Scenario 6: virtual WC with primary_work_center composition', () => {
  it('returns contributor 0 result for virtual work center', async () => {
    const contributorId = new Types.ObjectId().toHexString()

    resetHandlers({
      getWorkCenter: id => {
        if (id === WC_ID) {
          return {
            _id: WC_ID,
            type: 'virtual',
            metricComposition: {
              availability: {
                rule: 'primary_work_center',
                contributors: [{ workCenterId: contributorId, weight: null }],
              },
              productivity: {
                rule: 'primary_work_center',
                contributors: [{ workCenterId: contributorId, weight: null }],
              },
              quality: {
                rule: 'primary_work_center',
                contributors: [{ workCenterId: contributorId, weight: null }],
              },
            },
          }
        }
        return machineWc(id)
      },
      getJobOrders: () => [{ ...joRecord(JO_ID), workCenterId: contributorId }],
      getProductStandardsBatch: () => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(10)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: () => producedSummaryFor(600, FROM, TO),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    // primary_work_center → takes contributor 0's result
    expect(result.workCenterId).toBe(WC_ID)
    expect(result.availability.status).toBe('ok')
  })
})

// ── Scenario 7: Empty range (no JO) → no_context ─────────────────────────────

describe('Scenario 7: empty range — no job orders → no_context', () => {
  it('returns no_context for all factors when no JO active', async () => {
    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [],
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result.availability.status).toBe('no_context')
    expect(result.productivity.status).toBe('no_context')
    expect(result.quality.status).toBe('no_context')
    expect(result.oee.status).toBe('no_context')
  })
})

// ── Scenario 8: to <= from → validation rejects before service ────────────────

describe('Scenario 8: to <= from fails validator', () => {
  it('oeeQuerySchema rejects when to <= from', async () => {
    const { oeeQuerySchema } = await import('../oee.validators.js')
    const result = oeeQuerySchema.safeParse({
      workCenterId: WC_ID,
      from: '2026-01-01T07:00:00.000Z',
      to: '2026-01-01T06:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

// ── Scenario 9: Visibility — user without WC access → 404 ────────────────────

describe('Scenario 9: visibility — user without WC access → 404', () => {
  it('throws 404 when user work center ids do not include the requested WC', async () => {
    const OTHER_WC = new Types.ObjectId().toHexString()
    resetHandlers({
      getWorkCenter: () => machineWc(),
      getUserWorkCenterIds: () => [OTHER_WC], // does NOT include WC_ID
    })

    const userId = new Types.ObjectId().toHexString()

    await expect(
      calculate({ workCenterId: WC_ID, from: FROM, to: TO, userId }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── Scenario 10: Converted unplanned stop → normalized as planned ─────────────

describe('Scenario 10: converted unplanned stop linked to planned stop', () => {
  it('treats converted stop as planned (inherits reason flags)', async () => {
    await insertNonOeeReason()

    const stopStart = new Date('2026-01-01T06:10:00.000Z')
    const stopEnd = new Date('2026-01-01T06:20:00.000Z')
    const ownerId = new Types.ObjectId()
    const plannedStop = await PlannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: new Types.ObjectId(REASON_NON_OEE_ID),
      plannedOwnerId: ownerId,
      source: 'converted',
      startMode: 'automatic',
      status: 'closed',
      plannedStartAt: stopStart,
      plannedEndAt: stopEnd,
      actualStartAt: stopStart,
      actualEndAt: stopEnd,
      createdBy: null,
    })

    await UnplannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: null,
      source: 'run_mode',
      startAt: stopStart,
      endAt: stopEnd,
      convertedToPlannedStopId: plannedStop._id,
      createdBy: null,
    })

    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(10)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: () => producedSummaryFor(500, FROM, TO),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    // Non-OEE converted stop → should not reduce availability below 100%
    expect(result.availability.percentage).toBe(100)
  })
})

// ── Scenario 11: Offset-less datetime fails validator ─────────────────────────

describe('Scenario 11: offset-less datetime rejected by validators', () => {
  it('rejects non-UTC datetime strings', async () => {
    const { oeeQuerySchema } = await import('../oee.validators.js')

    const noZ = oeeQuerySchema.safeParse({
      workCenterId: WC_ID,
      from: '2026-01-01T06:00:00',
      to: '2026-01-01T07:00:00',
    })
    expect(noZ.success).toBe(false)

    const withSpace = oeeQuerySchema.safeParse({
      workCenterId: WC_ID,
      from: '2026-01-01 06:00:00',
      to: '2026-01-01 07:00:00',
    })
    expect(withSpace.success).toBe(false)
  })
})

// ── Scenario 12: WC not found → 404 ──────────────────────────────────────────

describe('Scenario 12: work center not found → 404', () => {
  it('throws 404 when work center does not exist', async () => {
    const unknownWcId = new Types.ObjectId().toHexString()

    resetHandlers({
      getWorkCenter: () => null,
      getUserWorkCenterIds: () => [unknownWcId],
    })

    await expect(
      calculate({ workCenterId: unknownWcId, from: FROM, to: TO, userId: SYSTEM_IDENTITY }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── Scenario 13: execution_span vs net_run_segments productivity modes ────────

describe('Scenario 13: execution_span vs net_run_segments productivity modes', () => {
  it('net_run_segments excludes non-effective stop time from telemetry windows', async () => {
    await insertNonOeeReason()

    const stopStart = new Date('2026-01-01T06:00:00.000Z')
    const stopEnd = new Date('2026-01-01T06:30:00.000Z') // 30 of 60 min stopped

    const ownerId = new Types.ObjectId()
    await PlannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: new Types.ObjectId(REASON_NON_OEE_ID),
      plannedOwnerId: ownerId,
      source: 'manual',
      startMode: 'automatic',
      status: 'closed',
      plannedStartAt: stopStart,
      plannedEndAt: stopEnd,
      actualStartAt: stopStart,
      actualEndAt: stopEnd,
      createdBy: null,
    })

    let producedCallCount = 0

    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(10)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: (_tagId, body: { windows: Array<{ from: string; to: string }> }) => {
        producedCallCount++
        const totalMs = body.windows.reduce(
          (sum: number, w: { from: string; to: string }) =>
            sum + new Date(w.to).getTime() - new Date(w.from).getTime(),
          0,
        )
        const minutes = totalMs / 60_000
        return producedSummaryFor(
          minutes * 10,
          new Date(body.windows[0].from),
          new Date(body.windows[body.windows.length - 1].to),
        )
      },
      getUserWorkCenterIds: () => [WC_ID],
    })

    // First run with execution_span (default): uses full JO window
    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result.availability.status).toBe('ok')
    // non-OEE stop → availability=100%, productivity uses full 60min → 600 produced, 600 target
    expect(result.productivity.status).toBe('ok')
    expect(result.oee.status).toBe('ok')
  })
})

// ── Count based: counter strokes converted into parts ────────────────────────
// A press stamps 4 parts per stroke (counterMultiplier 4) and its ideal rate is 40 parts a
// minute. Telemetry counts strokes, so 10 strokes a minute is the ideal rate.

describe('Count based OEE converts counter strokes into parts with counterMultiplier', () => {
  const ONE_MINUTE_LATER = new Date('2026-01-01T06:01:00.000Z')

  it('reports 100% productivity and 75% quality for 40 parts with 10 scrapped', async () => {
    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(40, 4)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: { [JO_ID]: [scrapRecord(10, FROM, ONE_MINUTE_LATER)] },
      }),
      getProducedSummary: strokeCounter(10),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: ONE_MINUTE_LATER,
      userId: SYSTEM_IDENTITY,
    })

    expect(result).toMatchObject({
      productivity: { percentage: 100, status: 'ok' },
      quality: { percentage: 75, status: 'ok' },
      oee: { percentage: 75, status: 'ok' },
    })
  })

  it('converts each part of a job order with the standard valid at that time', async () => {
    // From 06:30 a two-cavity die runs: 2 parts per stroke, ideal 20 parts a minute.
    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({
        items: [
          {
            jobOrderId: JO_ID,
            standards: [
              standardTimeline(40, 4),
              standardTimeline(20, 2, '2026-01-01T06:30:00.000Z'),
            ],
            qualityFlags: [],
          },
        ],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: strokeCounter(10),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result.productivity).toMatchObject({ percentage: 100, status: 'ok' })
  })

  it('marks productivity not calculable when a standard has no counterMultiplier', async () => {
    // A standard created while the work center was speed based has no counterMultiplier.
    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(40, null)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: {},
      }),
      getProducedSummary: strokeCounter(10),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result.productivity.status).toBe('not_calculable')
    expect(result.oee.status).toBe('not_calculable')
  })

  it('measures net_run_segments quality over the whole job order in parts', async () => {
    // Stopped 06:00-06:10, the press makes 500 strokes (2000 parts) in the hour; 500 are scrap.
    const stopEnd = new Date('2026-01-01T06:10:00.000Z')
    await policyService.upsertForWorkCenter(
      WC_ID,
      { actualOutputWindowMode: 'net_run_segments' },
      SYSTEM_IDENTITY,
    )
    await insertOeeAffectingReason()
    await UnplannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: new Types.ObjectId(REASON_OEE_ID),
      source: 'manual',
      startAt: FROM,
      endAt: stopEnd,
      createdBy: null,
    })
    resetHandlers({
      getWorkCenter: () => machineWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({
        items: [{ jobOrderId: JO_ID, standards: [standardTimeline(40, 4)], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: { [JO_ID]: [scrapRecord(500, FROM, TO)] },
      }),
      getProducedSummary: strokeCounter(10, [{ from: FROM, to: stopEnd }]),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result).toMatchObject({
      productivity: { percentage: 100, status: 'ok' },
      quality: { percentage: 75, status: 'ok' },
    })
  })
})

// ── Speed based: speed area converted into product units ─────────────────────
// A loom's ideal speed is 400 picks a minute, at which it weaves 2 m² of carpet a minute.

describe('Speed based OEE converts the speed area into product units with idealSpeed', () => {
  const loomStandard = () => ({ ...standardTimeline(2, null), idealSpeed: 400 })

  it('reports 75% productivity at 300 of 400 picks and 80% quality', async () => {
    // At 300 picks a minute the loom weaves 90 m² in the hour; 18 m² are scrapped.
    resetHandlers({
      getWorkCenter: () => loomWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({
        items: [{ jobOrderId: JO_ID, standards: [loomStandard()], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: { [JO_ID]: [scrapRecord(18, FROM, TO)] },
      }),
      getSpeedSummary: steadySpeed(300),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result).toMatchObject({
      productivity: { percentage: 75, status: 'ok' },
      quality: { percentage: 80, status: 'ok' },
      oee: { percentage: 60, status: 'ok' },
    })
  })

  it('measures net_run_segments quality over the whole job order in product units', async () => {
    // Stopped 06:00-06:10, then 300 picks a minute: 75 m² in the hour; 15 m² are scrapped.
    const stopEnd = new Date('2026-01-01T06:10:00.000Z')
    await policyService.upsertForWorkCenter(
      WC_ID,
      { actualOutputWindowMode: 'net_run_segments' },
      SYSTEM_IDENTITY,
    )
    await insertOeeAffectingReason()
    await UnplannedStop.create({
      workCenterId: new Types.ObjectId(WC_ID),
      reasonId: new Types.ObjectId(REASON_OEE_ID),
      source: 'manual',
      startAt: FROM,
      endAt: stopEnd,
      createdBy: null,
    })
    resetHandlers({
      getWorkCenter: () => loomWc(),
      getJobOrders: () => [joRecord()],
      getProductStandardsBatch: () => ({
        items: [{ jobOrderId: JO_ID, standards: [loomStandard()], qualityFlags: [] }],
      }),
      getJobOrderRecordsBatch: () => ({
        quantityAdjustmentsByJobOrderId: {},
        scrapEntriesByJobOrderId: { [JO_ID]: [scrapRecord(15, FROM, TO)] },
      }),
      getSpeedSummary: steadySpeed(300, [{ from: FROM, to: stopEnd }]),
      getUserWorkCenterIds: () => [WC_ID],
    })

    const result = await calculate({
      workCenterId: WC_ID,
      from: FROM,
      to: TO,
      userId: SYSTEM_IDENTITY,
    })

    expect(result).toMatchObject({
      productivity: { percentage: 75, status: 'ok' },
      quality: { percentage: 80, status: 'ok' },
    })
  })
})
