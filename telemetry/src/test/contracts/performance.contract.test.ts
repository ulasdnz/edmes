// Provider side of the contract with performance/src/lib/internal-api/telemetry.client.ts.
// Performance stubs produced-summary in its own tests, so this test feeds counter samples
// through the real ingestion pipeline and asserts what the real endpoint answers.
import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { setupMongoTestContainer } from '@mes/testing'
import type { Express } from 'express'
import { Types } from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { initExpress } from '../../core/loaders/express.js'
import { ingestValue } from '../../modules/ingestion/ingestion.pipeline.js'
import Tag from '../../modules/tag/tag.model.js'

setupMongoTestContainer()

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string
const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 9, 28, 6, minute, second))

let app: Express

beforeAll(async () => {
  app = await initExpress()
})

describe('POST /internal/v1/historian/:tagId/produced-summary (performance producedSummary)', () => {
  it('answers the raw counter delta of each requested window, in request order', async () => {
    const tag = await Tag.create({
      name: 'Press stroke counter',
      tagTypeId: new Types.ObjectId(),
      behavior: 'counter',
    })
    // 10 strokes a minute: the counter goes up by one every 6 seconds from 06:00 to 06:02.
    for (let stroke = 0; stroke <= 20; stroke++) {
      await ingestValue(tag, 1000 + stroke, at(0, stroke * 6))
    }

    const res = await request(app)
      .post(`/internal/v1/historian/${tag.id}/produced-summary`)
      .set({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN })
      .send({
        windows: [
          { from: at(0).toISOString(), to: at(1).toISOString() },
          { from: at(1).toISOString(), to: at(1, 30).toISOString() },
        ],
      })

    expect(res.status, JSON.stringify(res.body.error)).toBe(200)
    expect(res.body.data).toEqual({
      windows: [
        { from: at(0).toISOString(), to: at(1).toISOString(), value: 10, qualityFlags: [] },
        { from: at(1).toISOString(), to: at(1, 30).toISOString(), value: 5, qualityFlags: [] },
      ],
      total: 15,
    })
  })
})

describe('POST /internal/v1/historian/:tagId/speed-summary (performance speedSummary)', () => {
  it('answers the speed area of each requested window, in request order', async () => {
    const tag = await Tag.create({
      name: 'Loom speed',
      tagTypeId: new Types.ObjectId(),
      behavior: 'speed',
    })
    // The loom runs at 300 picks a minute from 06:00 and at 400 from 06:30.
    await ingestValue(tag, 300, at(0))
    await ingestValue(tag, 400, at(30))

    const res = await request(app)
      .post(`/internal/v1/historian/${tag.id}/speed-summary`)
      .set({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN })
      .send({
        windows: [
          { from: at(0).toISOString(), to: at(30).toISOString() },
          { from: at(30).toISOString(), to: at(60).toISOString() },
        ],
      })

    // valueArea is speed × milliseconds; performance divides it by 60 000 for speed × minutes.
    expect(res.status, JSON.stringify(res.body.error)).toBe(200)
    expect(res.body.data.windows).toMatchObject([
      { from: at(0).toISOString(), to: at(30).toISOString(), valueArea: 300 * 30 * 60_000 },
      { from: at(30).toISOString(), to: at(60).toISOString(), valueArea: 400 * 30 * 60_000 },
    ])
  })
})
