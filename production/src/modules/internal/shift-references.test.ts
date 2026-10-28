import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { Types } from 'mongoose'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { initExpress } from '../../core/loaders/express.js'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string

describe('GET /internal/v1/shifts/:id/references', () => {
  beforeEach(async () => {
    await Promise.all([QuantityAdjustment.deleteMany({}), ScrapEntry.deleteMany({})])
  })

  it('rejects calls without the internal token', async () => {
    const app = await initExpress()
    const shiftId = new Types.ObjectId().toHexString()
    const res = await request(app).get(`/internal/v1/shifts/${shiftId}/references`)
    expect(res.status).toBe(401)
  })

  it('returns inUse=false when no references', async () => {
    const app = await initExpress()
    const shiftId = new Types.ObjectId().toHexString()
    const res = await request(app)
      .get(`/internal/v1/shifts/${shiftId}/references`)
      .set(INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ inUse: false })
  })

  it('returns inUse=true when a QuantityAdjustment references the shift', async () => {
    const app = await initExpress()
    const shiftId = new Types.ObjectId()
    await QuantityAdjustment.create({
      jobOrderId: new Types.ObjectId(),
      workCenterId: new Types.ObjectId(),
      productId: new Types.ObjectId(),
      shiftId,
      amount: 1,
      time: new Date(),
      createdBy: new Types.ObjectId(),
    })
    const res = await request(app)
      .get(`/internal/v1/shifts/${shiftId.toHexString()}/references`)
      .set(INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN)
    expect(res.body.data.inUse).toBe(true)
  })
})
