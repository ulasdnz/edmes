// Provider side of the contracts with performance/src/lib/internal-api/work-center.client.ts and
// production/src/lib/internal-api.ts. Both consumers stub these endpoints in their own tests, so
// these tests call the real work-center app and assert the fields the consumers read.
import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import type { Express } from 'express'
import { Types } from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { initExpress } from '../../core/loaders/express.js'
import { Shift } from '../../modules/shift/shift.model.js'
import WorkCenter from '../../modules/work-center/work-center.model.js'

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string
const actor = new Types.ObjectId()

let app: Express
let seq = 0

beforeAll(async () => {
  app = await initExpress()
})

const getInternal = (path: string) =>
  request(app)
    .get(`/internal/v1${path}`)
    .set({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN })

const createWorkCenter = (doc: Record<string, unknown>) =>
  WorkCenter.create({
    code: `WC-${++seq}`,
    name: `Work center ${seq}`,
    createdBy: actor,
    updatedBy: actor,
    ...doc,
  })

describe('GET /internal/v1/work-centers/:id (performance getById, production getWorkCenterInfo)', () => {
  it('returns the type, mode, status and counter tag performance reads for count based OEE', async () => {
    const runModeTagId = new Types.ObjectId()
    const productionCounterTagId = new Types.ObjectId()
    const workCenter = await createWorkCenter({
      type: 'physical',
      productivityMode: 'count_based',
      tagBindings: { runModeTagId, productionCounterTagId },
    })

    const res = await getInternal(`/work-centers/${workCenter.id}`)

    expect(res.status, JSON.stringify(res.body.error)).toBe(200)
    expect(res.body.data).toMatchObject({
      _id: workCenter.id,
      type: 'physical',
      productivityMode: 'count_based',
      status: 'active',
      tagBindings: {
        runModeTagId: runModeTagId.toHexString(),
        productionCounterTagId: productionCounterTagId.toHexString(),
      },
    })
  })

  it('returns the speed tag performance reads for speed based OEE', async () => {
    const runModeTagId = new Types.ObjectId()
    const speedTagId = new Types.ObjectId()
    const workCenter = await createWorkCenter({
      type: 'physical',
      productivityMode: 'speed_based',
      tagBindings: { runModeTagId, speedTagId },
    })

    const res = await getInternal(`/work-centers/${workCenter.id}`)

    expect(res.status, JSON.stringify(res.body.error)).toBe(200)
    expect(res.body.data).toMatchObject({
      productivityMode: 'speed_based',
      tagBindings: {
        runModeTagId: runModeTagId.toHexString(),
        speedTagId: speedTagId.toHexString(),
      },
    })
  })

  it('returns the metric composition of a virtual work center', async () => {
    const contributor = await createWorkCenter({
      type: 'physical',
      productivityMode: 'count_based',
      tagBindings: { runModeTagId: new Types.ObjectId() },
    })
    const rule = { rule: 'primary_work_center', contributors: [{ workCenterId: contributor._id }] }
    const virtual = await createWorkCenter({
      type: 'virtual',
      metricComposition: { availability: rule, productivity: rule, quality: rule },
    })

    const res = await getInternal(`/work-centers/${virtual.id}`)

    expect(res.status, JSON.stringify(res.body.error)).toBe(200)
    expect(res.body.data.type).toBe('virtual')
    expect(res.body.data.metricComposition.availability).toMatchObject({
      rule: 'primary_work_center',
      contributors: [expect.objectContaining({ workCenterId: contributor.id })],
    })
  })

  it('answers 404 for an unknown id', async () => {
    const res = await getInternal(`/work-centers/${new Types.ObjectId().toHexString()}`)
    expect(res.status).toBe(404)
  })
})

describe('GET /internal/v1/shifts/:id (production assertShiftExists)', () => {
  it('answers 200 for an existing shift and 404 for an unknown one', async () => {
    const shift = await Shift.create({
      name: 'Morning',
      startHour: 6,
      startMinute: 0,
      endHour: 14,
      endMinute: 0,
      createdBy: actor,
      updatedBy: actor,
    })

    const existing = await getInternal(`/shifts/${shift.id}`)
    const unknown = await getInternal(`/shifts/${new Types.ObjectId().toHexString()}`)

    expect(existing.status, JSON.stringify(existing.body.error)).toBe(200)
    expect(unknown.status).toBe(404)
  })
})
