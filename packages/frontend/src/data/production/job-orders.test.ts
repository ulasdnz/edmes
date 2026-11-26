import { createApiClient } from '@mes/api-client'
import { describe, expect, it } from 'vitest'
import { queryMatchesEvent } from '../../realtime'
import { type JobOrder, runningJobOrderOptions } from './job-orders'

const api = createApiClient({
  getToken: () => null,
  getLocale: () => 'en',
  onUnauthorized: () => {},
})

function jobOrder(code: string): JobOrder {
  return {
    _id: `id-${code}`,
    code,
    productId: 'p1',
    workCenterId: 'wc1',
    productionPlanId: null,
    targetQuantity: 10,
    plannedStartAt: null,
    dueAt: null,
    startTime: '2026-11-25T06:00:00.000Z',
    endTime: null,
    description: null,
    props: {},
    createdBy: 'u1',
    updatedBy: null,
    startedBy: 'u1',
    endedBy: null,
    createdAt: '2026-11-25T05:00:00.000Z',
    updatedAt: '2026-11-25T06:00:00.000Z',
  }
}

const pagination = { page: 1, limit: 1, total: 0, totalPages: 1 }

describe('running job order', () => {
  it('asks for the one running job order of the work center', () => {
    expect(runningJobOrderOptions(api, 'wc1').queryKey).toEqual([
      'get',
      '/job-orders',
      { params: { query: { workCenterIds: 'wc1', runtimeState: 'running', limit: 1 } } },
    ])
  })

  it('selects the first job order, or null when none is running', () => {
    const select = runningJobOrderOptions(api, 'wc1').select as (response: unknown) => unknown
    const first = jobOrder('JO-1')
    expect(select({ data: [first], pagination: { ...pagination, total: 1 } })).toBe(first)
    expect(select({ data: [], pagination })).toBeNull()
  })

  it('is refetched by job order events of its own work center only', () => {
    const query = { queryKey: runningJobOrderOptions(api, 'wc1').queryKey, meta: undefined }
    expect(queryMatchesEvent(query, ['/job-orders'], ['wc1'])).toBe(true)
    expect(queryMatchesEvent(query, ['/job-orders'], ['wc2'])).toBe(false)
  })
})
