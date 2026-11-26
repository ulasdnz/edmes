import { createApiClient } from '@mes/api-client'
import { describe, expect, it } from 'vitest'
import { workCentersListOptions } from './work-centers'

const api = createApiClient({
  getToken: () => null,
  getLocale: () => 'en',
  onUnauthorized: () => {},
})

describe('work centers list', () => {
  it('asks for one page as large as the server allows', () => {
    expect(workCentersListOptions(api, { status: 'active' }).queryKey).toEqual([
      'get',
      '/work-centers',
      { params: { query: { status: 'active', limit: 100 } } },
    ])
  })

  it('leaves out a status that is not given', () => {
    expect(workCentersListOptions(api, {}).queryKey).toEqual([
      'get',
      '/work-centers',
      { params: { query: { limit: 100 } } },
    ])
  })
})
