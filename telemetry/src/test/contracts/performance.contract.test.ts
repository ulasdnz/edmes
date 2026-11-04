// Provider side of the contract with performance/src/lib/internal-api/telemetry.client.ts and
// run-mode-telemetry.client.ts. Performance stubs these endpoints in its own tests, so this test
// feeds samples through the real ingestion pipeline and asserts what the real endpoints answer.
import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { setupMongoDatabase } from '@mes/testing'
import type { Express } from 'express'
import { Types } from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { initExpress } from '../../core/loaders/express.js'
import { ingestValue } from '../../modules/ingestion/ingestion.pipeline.js'
import Tag from '../../modules/tag/tag.model.js'

setupMongoDatabase()

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

describe('GET /internal/v1/historian/:tagId/state-durations (performance run-mode replay)', () => {
  it('answers the stored samples in [from, to) as segments, a page of limit samples at a time', async () => {
    const tag = await Tag.create({
      name: 'Press run mode',
      tagTypeId: new Types.ObjectId(),
      behavior: 'binary',
    })
    // The press stops at 06:00, runs at 06:05, stops at 06:10 and runs again at 06:15.
    await ingestValue(tag, 0, at(0))
    await ingestValue(tag, 1, at(5))
    await ingestValue(tag, 0, at(10))
    await ingestValue(tag, 1, at(15))

    const stateDurations = async (query: Record<string, string>) => {
      const res = await request(app)
        .get(`/internal/v1/historian/${tag.id}/state-durations`)
        .query(query)
        .set({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN })
      expect(res.status, JSON.stringify(res.body.error)).toBe(200)
      return res.body.data
    }
    const segment = (state: number, start: Date, end: Date) => ({
      state,
      start: start.toISOString(),
      end: end.toISOString(),
      durationMs: end.getTime() - start.getTime(),
    })
    const window = { from: at(0).toISOString(), to: at(20).toISOString() }

    // As performance asks, without a limit: every sample from its cursor up to the one it holds.
    expect(await stateDurations(window)).toEqual({
      segments: [
        segment(0, at(0), at(5)),
        segment(1, at(5), at(10)),
        segment(0, at(10), at(15)),
        segment(1, at(15), at(20)),
      ],
      hasMore: false,
      nextCursor: null,
    })

    // Clipped to the window: the state before `from` opens it, a sample at or after `to` is left out.
    expect(await stateDurations({ from: at(2).toISOString(), to: at(15).toISOString() })).toEqual({
      segments: [segment(0, at(2), at(5)), segment(1, at(5), at(10)), segment(0, at(10), at(15))],
      hasMore: false,
      nextCursor: null,
    })

    // Two samples a page: the segment still in progress is left to the next page, which starts at
    // nextCursor, the last sample of the page, again (`after` is inclusive).
    expect(await stateDurations({ ...window, limit: '2' })).toEqual({
      segments: [segment(0, at(0), at(5))],
      hasMore: true,
      nextCursor: at(5).toISOString(),
    })
    expect(await stateDurations({ ...window, limit: '2', after: at(5).toISOString() })).toEqual({
      segments: [segment(1, at(5), at(10))],
      hasMore: true,
      nextCursor: at(10).toISOString(),
    })
    expect(await stateDurations({ ...window, limit: '2', after: at(10).toISOString() })).toEqual({
      segments: [segment(0, at(10), at(15)), segment(1, at(15), at(20))],
      hasMore: false,
      nextCursor: null,
    })
  })
})
