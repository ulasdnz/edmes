import { vi } from 'vitest'

export interface ApiRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: Headers
}

export type ApiAnswer = { status?: number; body: unknown } | 'network-error'

// Answers the app's requests to /api/v1 in place of the server; every other request goes out as
// usual. The answer may be a promise that never settles, to keep a request pending.
export function serveApi(answer: (request: ApiRequest) => ApiAnswer | Promise<ApiAnswer>) {
  const asked: ApiRequest[] = []
  const realFetch = globalThis.fetch.bind(globalThis)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/v1/')) return realFetch(input, init)
    const seen = {
      method: request.method,
      path: url.pathname.slice('/api/v1'.length),
      query: url.searchParams,
      headers: request.headers,
    }
    asked.push(seen)
    const result = await answer(seen)
    if (result === 'network-error') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return asked
}

export const unavailable: ApiAnswer = {
  status: 503,
  body: { error: { code: 'gateway.unavailable', message: 'Service unavailable' } },
}
