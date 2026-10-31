import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as productionClient from './production.client.js'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('findStartedJobOrders', () => {
  const from = new Date('2026-01-01T06:00:00.000Z')
  const to = new Date('2026-01-01T18:00:00.000Z')
  const wcId = 'aaaaaaaaaaaaaaaaaaaaaaaa'

  // The production provider contract test replays exactly this request.
  it('asks production for the job order windows of the work center in [from, to)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })

    await productionClient.findStartedJobOrders({ workCenterId: wcId, from, to })

    const url = new URL(fetchMock.mock.calls.at(-1)?.[0] as string)
    expect(url.pathname).toBe('/internal/v1/job-order-windows')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      workCenterId: wcId,
      from: from.toISOString(),
      to: to.toISOString(),
    })
  })

  it('maps each window and ends a running job order at the end of the range', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
            workCenterId: wcId,
            productId: 'cccccccccccccccccccccccc',
            startTime: '2026-01-01T06:00:00.000Z',
            endTime: '2026-01-01T14:00:00.000Z',
          },
          {
            _id: 'dddddddddddddddddddddddd',
            workCenterId: wcId,
            productId: 'cccccccccccccccccccccccc',
            startTime: '2026-01-01T15:00:00.000Z',
            endTime: null,
          },
        ],
      }),
    })

    const result = await productionClient.findStartedJobOrders({ workCenterId: wcId, from, to })

    expect(result).toEqual([
      {
        jobOrderId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        workCenterId: wcId,
        productId: 'cccccccccccccccccccccccc',
        start: new Date('2026-01-01T06:00:00.000Z'),
        end: new Date('2026-01-01T14:00:00.000Z'),
      },
      {
        jobOrderId: 'dddddddddddddddddddddddd',
        workCenterId: wcId,
        productId: 'cccccccccccccccccccccccc',
        start: new Date('2026-01-01T15:00:00.000Z'),
        end: to,
      },
    ])
  })

  it('reports production as unreachable instead of returning no job orders', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(
      productionClient.findStartedJobOrders({ workCenterId: wcId, from, to }),
    ).rejects.toMatchObject({ statusCode: 503, message: 'error.production_unreachable' })
  })

  it('reports production as unreachable when the request cannot reach it', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))

    await expect(
      productionClient.findStartedJobOrders({ workCenterId: wcId, from, to }),
    ).rejects.toMatchObject({ statusCode: 503, message: 'error.production_unreachable' })
  })
})

describe('findProductStandardTimelinesBatch', () => {
  it('returns the data map keyed by jobOrderId', async () => {
    const items = [
      {
        jobOrderId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        workCenterId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        productId: 'cccccccccccccccccccccccc',
        from: new Date('2026-01-01T06:00:00Z'),
        to: new Date('2026-01-01T18:00:00Z'),
      },
    ]

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          items: [
            {
              jobOrderId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
              standards: [
                {
                  _id: 'eeeeeeeeeeeeeeeeeeeeeeee',
                  validFrom: '2026-01-01T00:00:00.000Z',
                  idealOutputPerMinute: 10,
                  counterMultiplier: 1,
                  idealSpeed: null,
                },
              ],
              qualityFlags: [],
            },
          ],
        },
      }),
    })

    const result = await productionClient.findProductStandardTimelinesBatch(items)
    expect(result['bbbbbbbbbbbbbbbbbbbbbbbb']).toHaveLength(1)
    expect(result['bbbbbbbbbbbbbbbbbbbbbbbb'][0].idealOutputPerMinute).toBe(10)
  })

  it('reports production as unreachable instead of returning no standards', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(
      productionClient.findProductStandardTimelinesBatch([
        {
          jobOrderId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
          workCenterId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
          productId: 'cccccccccccccccccccccccc',
          from: new Date(),
          to: new Date(),
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 503, message: 'error.production_unreachable' })
  })
})

describe('findJobOrderRecordsBatch', () => {
  it('returns quantity adjustments and scrap entries keyed by jobOrderId', async () => {
    const items = [
      {
        jobOrderId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        from: new Date('2026-01-01T06:00:00Z'),
        to: new Date('2026-01-01T18:00:00Z'),
      },
    ]

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          quantityAdjustmentsByJobOrderId: {
            bbbbbbbbbbbbbbbbbbbbbbbb: [{ _id: 'x', amount: -50, time: '2026-01-01T10:00:00Z' }],
          },
          scrapEntriesByJobOrderId: {
            bbbbbbbbbbbbbbbbbbbbbbbb: [],
          },
        },
      }),
    })

    const result = await productionClient.findJobOrderRecordsBatch({
      items,
      include: ['quantity_adjustments', 'scrap_entries'],
    })
    expect(result.quantityAdjustmentsByJobOrderId['bbbbbbbbbbbbbbbbbbbbbbbb']).toHaveLength(1)
    expect(result.scrapEntriesByJobOrderId['bbbbbbbbbbbbbbbbbbbbbbbb']).toHaveLength(0)
  })

  it('reports production as unreachable instead of returning no records', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(
      productionClient.findJobOrderRecordsBatch({
        items: [
          {
            jobOrderId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
            from: new Date(),
            to: new Date(),
          },
        ],
        include: ['quantity_adjustments'],
      }),
    ).rejects.toMatchObject({ statusCode: 503, message: 'error.production_unreachable' })
  })
})
