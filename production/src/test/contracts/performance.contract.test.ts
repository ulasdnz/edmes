// Provider side of the contract with performance/src/lib/internal-api/production.client.ts.
// Performance stubs these endpoints in its own tests, so these tests replay its real requests
// against the real production app and assert the fields it reads.
import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import type { Express } from 'express'
import { Types } from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { initExpress } from '../../core/loaders/express.js'
import { JobOrder } from '../../modules/job-order/job-order.model.js'
import { ProductStandard } from '../../modules/product-standard/product-standard.model.js'
import { QuantityAdjustment } from '../../modules/quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../../modules/scrap-entry/scrap-entry.model.js'

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string
const actor = new Types.ObjectId()
const workCenterId = new Types.ObjectId()
const productId = new Types.ObjectId()
const shiftId = new Types.ObjectId()

const from = new Date('2026-10-28T06:00:00.000Z')
const to = new Date('2026-10-28T14:00:00.000Z')
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 28, hour, minute)).toISOString()

let app: Express
let seq = 0

beforeAll(async () => {
  app = await initExpress()
})

const internal = () => ({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN })

const createJobOrder = (doc: Record<string, unknown>) =>
  JobOrder.create({
    code: `JO-${++seq}`,
    productId,
    workCenterId,
    targetQuantity: 100,
    createdBy: actor,
    ...doc,
  })

describe('GET /internal/v1/job-order-windows (performance findStartedJobOrders)', () => {
  // Same query string performance builds in findStartedJobOrders.
  const performanceQuery = (wcId: Types.ObjectId) =>
    new URLSearchParams({
      workCenterId: wcId.toHexString(),
      from: from.toISOString(),
      to: to.toISOString(),
    })

  it('rejects a call without the internal token', async () => {
    const res = await request(app).get(
      `/internal/v1/job-order-windows?${performanceQuery(workCenterId)}`,
    )
    expect(res.status).toBe(401)
  })

  it('returns every started job order overlapping the window, oldest first, with the fields performance reads', async () => {
    const finished = await createJobOrder({ startTime: at(5), endTime: at(7) })
    const running = await createJobOrder({ startTime: at(9), endTime: null })
    await createJobOrder({ startTime: null })
    await createJobOrder({ startTime: at(2), endTime: at(4) })
    await createJobOrder({ workCenterId: new Types.ObjectId(), startTime: at(8) })

    const res = await request(app)
      .get(`/internal/v1/job-order-windows?${performanceQuery(workCenterId)}`)
      .set(internal())

    expect(res.status, JSON.stringify(res.body.error)).toBe(200)
    expect(res.body.data).toEqual([
      {
        _id: finished.id,
        workCenterId: workCenterId.toHexString(),
        productId: productId.toHexString(),
        startTime: at(5),
        endTime: at(7),
      },
      {
        _id: running.id,
        workCenterId: workCenterId.toHexString(),
        productId: productId.toHexString(),
        startTime: at(9),
        endTime: null,
      },
    ])
  })

  it('rejects a window whose end is not after its start', async () => {
    const query = new URLSearchParams({
      workCenterId: workCenterId.toHexString(),
      from: to.toISOString(),
      to: from.toISOString(),
    })

    const res = await request(app).get(`/internal/v1/job-order-windows?${query}`).set(internal())

    expect(res.status).toBe(400)
  })
})

describe('POST /internal/v1/product-standards/timelines:batch (performance timelines)', () => {
  const timelinesRequest = (jobOrderId: Types.ObjectId) => ({
    items: [
      {
        jobOrderId: jobOrderId.toHexString(),
        workCenterId: workCenterId.toHexString(),
        productId: productId.toHexString(),
        from: from.toISOString(),
        to: to.toISOString(),
      },
    ],
  })

  it('returns every standard field performance reads, including idealSpeed', async () => {
    await ProductStandard.create({
      productId,
      workCenterId,
      validFrom: new Date('2026-10-01T00:00:00.000Z'),
      idealOutputPerMinute: 12,
      counterMultiplier: 2,
      idealSpeed: 600,
      createdBy: actor,
    })
    const jobOrderId = new Types.ObjectId()

    const res = await request(app)
      .post('/internal/v1/product-standards/timelines:batch')
      .set(internal())
      .send(timelinesRequest(jobOrderId))

    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(1)
    const [item] = res.body.data.items
    expect(item).toMatchObject({ jobOrderId: jobOrderId.toHexString(), qualityFlags: [] })
    expect(item.standards).toHaveLength(1)
    expect(item.standards[0]).toMatchObject({
      validFrom: '2026-10-01T00:00:00.000Z',
      idealOutputPerMinute: 12,
      counterMultiplier: 2,
      idealSpeed: 600,
    })
    expect(typeof item.standards[0]._id).toBe('string')
  })

  it('flags an interval without a standard', async () => {
    const jobOrderId = new Types.ObjectId()

    const res = await request(app)
      .post('/internal/v1/product-standards/timelines:batch')
      .set(internal())
      .send(timelinesRequest(jobOrderId))

    expect(res.status).toBe(200)
    expect(res.body.data.items[0]).toMatchObject({
      jobOrderId: jobOrderId.toHexString(),
      standards: [],
      qualityFlags: ['no_standard_for_interval'],
    })
  })
})

describe('POST /internal/v1/job-order-records:batch (performance quality records)', () => {
  it('groups quantity adjustments and scrap entries by job order with the fields performance reads', async () => {
    const jobOrderId = new Types.ObjectId()
    const reasonId = new Types.ObjectId()
    const adjustment = await QuantityAdjustment.create({
      jobOrderId,
      workCenterId,
      productId,
      shiftId,
      amount: 5,
      time: at(8),
      reason: 'manual_count',
      createdBy: actor,
    })
    const scrap = await ScrapEntry.create({
      jobOrderId,
      workCenterId,
      productId,
      shiftId,
      amount: 2,
      startTime: at(9),
      endTime: at(10),
      reasonId,
      createdBy: actor,
    })

    const res = await request(app)
      .post('/internal/v1/job-order-records:batch')
      .set(internal())
      .send({
        items: [
          { jobOrderId: jobOrderId.toHexString(), from: from.toISOString(), to: to.toISOString() },
        ],
        include: ['quantity_adjustments', 'scrap_entries'],
      })

    expect(res.status).toBe(200)
    const key = jobOrderId.toHexString()
    expect(res.body.data.quantityAdjustmentsByJobOrderId[key]).toEqual([
      expect.objectContaining({ _id: adjustment.id, amount: 5, time: at(8) }),
    ])
    expect(res.body.data.scrapEntriesByJobOrderId[key]).toEqual([
      expect.objectContaining({
        _id: scrap.id,
        amount: 2,
        reasonId: reasonId.toHexString(),
        startTime: at(9),
        endTime: at(10),
      }),
    ])
  })
})
