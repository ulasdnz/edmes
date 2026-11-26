import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApiClient } from '@mes/api-client'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { workCentersListOptions } from './work-centers'

const api = createApiClient({
  getToken: () => null,
  getLocale: () => 'en',
  onUnauthorized: () => {},
})

describe('work centers list', () => {
  it('asks for pages as large as the server allows', () => {
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

  describe('against a server', () => {
    let server: Server | undefined
    const asked: URLSearchParams[] = []

    afterEach(async () => {
      asked.length = 0
      await new Promise(resolve => server?.close(resolve))
    })

    async function serve(total: number, failPage?: number) {
      server = createServer((req, res) => {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams
        asked.push(query)
        const page = Number(query.get('page') ?? 1)
        const limit = Number(query.get('limit') ?? 20)
        res.setHeader('content-type', 'application/json')
        if (page === failPage) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: { code: 'service.unavailable', message: 'down' } }))
          return
        }
        const from = (page - 1) * limit
        const data = Array.from({ length: Math.max(0, Math.min(limit, total - from)) }, (_, i) => ({
          _id: String(from + i).padStart(24, '0'),
          name: `WC ${from + i}`,
        }))
        res.end(
          JSON.stringify({
            data,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          }),
        )
      })
      await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      return createApiClient({
        baseUrl: `http://127.0.0.1:${port}`,
        getToken: () => null,
        getLocale: () => 'en',
        onUnauthorized: () => {},
      })
    }

    it('reads every page, so a station past the first hundred is still in the list', async () => {
      const client = await serve(250)

      const result = await new QueryClient().fetchQuery(
        workCentersListOptions(client, { status: 'active' }),
      )

      expect(result.data).toHaveLength(250)
      expect(result.data.at(-1)?.name).toBe('WC 249')
      expect(result.pagination.total).toBe(250)
      expect(asked.map(query => query.get('page'))).toEqual(['1', '2', '3'])
      expect(asked.every(query => query.get('status') === 'active')).toBe(true)
      expect(asked.every(query => query.get('limit') === '100')).toBe(true)
    })

    // scenario: everything fits on one page, or there is no work center → one request
    it.each([
      ['everything fits on one page', 37],
      ['there is no work center', 0],
    ])('asks once when %s', async (_name, total) => {
      const client = await serve(total)

      const result = await new QueryClient().fetchQuery(workCentersListOptions(client, {}))

      expect(result.data).toHaveLength(total)
      expect(asked).toHaveLength(1)
    })

    it('fails the whole list when a later page fails, never answering with part of it', async () => {
      const client = await serve(250, 2)

      await expect(
        new QueryClient().fetchQuery(workCentersListOptions(client, { status: 'active' })),
      ).rejects.toMatchObject({ status: 503 })
    })
  })
})
