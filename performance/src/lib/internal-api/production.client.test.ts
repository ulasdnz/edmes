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
  it('returns started job orders mapped to JobWindow', async () => {
    const from = new Date('2026-01-01T06:00:00Z')
    const to = new Date('2026-01-01T18:00:00Z')
    const wcId = 'aaaaaaaaaaaaaaaaaaaaaaaa'

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
            code: 'JO-001',
          },
          {
            _id: 'dddddddddddddddddddddddd',
            workCenterId: wcId,
            productId: 'cccccccccccccccccccccccc',
            startTime: null,
            endTime: null,
            code: 'JO-002',
          },
        ],
      }),
    })

    const result = await productionClient.findStartedJobOrders({ workCenterId: wcId, from, to })

    expect(result).toHaveLength(1)
    expect(result[0].jobOrderId).toBe('bbbbbbbbbbbbbbbbbbbbbbbb')
    expect(result[0].start).toBeInstanceOf(Date)
    expect(result[0].end).toBeInstanceOf(Date)
  })

  it('returns empty array when fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    const result = await productionClient.findStartedJobOrders({
      workCenterId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      from: new Date(),
      to: new Date(),
    })
    expect(result).toEqual([])
  })

  it('returns empty array on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const result = await productionClient.findStartedJobOrders({
      workCenterId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      from: new Date(),
      to: new Date(),
    })
    expect(result).toEqual([])
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

  it('returns empty map on failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    const result = await productionClient.findProductStandardTimelinesBatch([
      {
        jobOrderId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        workCenterId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        productId: 'cccccccccccccccccccccccc',
        from: new Date(),
        to: new Date(),
      },
    ])
    expect(result).toEqual({})
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

  it('returns empty maps on failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    const result = await productionClient.findJobOrderRecordsBatch({
      items: [
        {
          jobOrderId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
          from: new Date(),
          to: new Date(),
        },
      ],
      include: ['quantity_adjustments'],
    })
    expect(result.quantityAdjustmentsByJobOrderId).toEqual({})
    expect(result.scrapEntriesByJobOrderId).toEqual({})
  })
})
