import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api-error'
import { createApiClient } from './client'

interface Seen {
  headers: IncomingHttpHeaders
  url: string
}

type Reply = { status: number; body?: string; headers?: Record<string, string>; delayMs?: number }

const servers: Server[] = []

async function serve(reply: Reply) {
  const seen: Seen = { headers: {}, url: '' }
  const server = createServer((req, res) => {
    seen.headers = req.headers
    seen.url = req.url ?? ''
    req.resume()
    setTimeout(() => {
      res.writeHead(reply.status, reply.headers ?? { 'content-type': 'application/json' })
      res.end(reply.body ?? '{}')
    }, reply.delayMs ?? 0)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { seen, baseUrl: `http://127.0.0.1:${port}`, server }
}

function setup(
  baseUrl: string,
  options: {
    token?: string | null
    timeoutMs?: number
    getToken?: () => string | null
    onUnauthorized?: () => void
  } = {},
) {
  const onUnauthorized = vi.fn(options.onUnauthorized)
  const { fetchClient } = createApiClient({
    baseUrl,
    getToken: options.getToken ?? (() => (options.token === undefined ? 'tkn' : options.token)),
    getLocale: () => 'tr',
    onUnauthorized,
    timeoutMs: options.timeoutMs,
  })
  return { fetchClient, onUnauthorized }
}

const envelope = (code: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ error: { code, message: code, ...extra } })

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))),
  )
})

describe('createApiClient', () => {
  it('sends the bearer token and the locale', async () => {
    const { seen, baseUrl } = await serve({ status: 200, body: '{"data":[]}' })
    const { fetchClient } = setup(baseUrl)
    await fetchClient.GET('/users/languages')
    expect(seen.headers.authorization).toBe('Bearer tkn')
    expect(seen.headers['accept-language']).toBe('tr')
  })

  it('sends no Authorization header without a token', async () => {
    const { seen, baseUrl } = await serve({ status: 200, body: '{"data":[]}' })
    const { fetchClient } = setup(baseUrl, { token: null })
    await fetchClient.GET('/users/languages')
    expect(seen.headers.authorization).toBeUndefined()
    expect(seen.headers['accept-language']).toBe('tr')
  })

  it('rejects a non-2xx with the status, code and details of the envelope', async () => {
    const { baseUrl } = await serve({
      status: 400,
      body: envelope('error.validation_failed', {
        message: 'Validation failed',
        details: [{ field: 'email', message: 'Invalid email' }],
      }),
    })
    const { fetchClient } = setup(baseUrl)
    await expect(fetchClient.GET('/users/languages')).rejects.toMatchObject({
      kind: 'http',
      status: 400,
      code: 'error.validation_failed',
      message: 'Validation failed',
      details: [{ field: 'email', message: 'Invalid email' }],
    })
  })

  it('carries the trace id of the response', async () => {
    const { baseUrl } = await serve({
      status: 500,
      body: envelope('error.internal'),
      headers: { 'content-type': 'application/json', 'x-trace-id': 'abc-123' },
    })
    const { fetchClient } = setup(baseUrl)
    await expect(fetchClient.GET('/users/languages')).rejects.toMatchObject({
      traceId: 'abc-123',
    })
  })

  it('calls onUnauthorized once on 401 auth.unauthenticated', async () => {
    const { baseUrl } = await serve({ status: 401, body: envelope('auth.unauthenticated') })
    const { fetchClient, onUnauthorized } = setup(baseUrl)
    await expect(fetchClient.GET('/users/languages')).rejects.toMatchObject({
      status: 401,
      code: 'auth.unauthenticated',
    })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('does not call onUnauthorized for a 401 from /auth/login', async () => {
    const { baseUrl } = await serve({ status: 401, body: envelope('auth.invalid_credentials') })
    const { fetchClient, onUnauthorized } = setup(baseUrl, { token: null })
    await expect(
      fetchClient.POST('/auth/login', { body: { email: 'a@b.co', password: 'x' } }),
    ).rejects.toMatchObject({ status: 401, code: 'auth.invalid_credentials' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('does not call onUnauthorized on 503 auth.unavailable', async () => {
    const { baseUrl } = await serve({ status: 503, body: envelope('auth.unavailable') })
    const { fetchClient, onUnauthorized } = setup(baseUrl)
    await expect(fetchClient.GET('/users/languages')).rejects.toMatchObject({
      status: 503,
      code: 'auth.unavailable',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('maps a refused connection to kind network', async () => {
    const { baseUrl, server } = await serve({ status: 200 })
    await new Promise<void>(resolve => server.close(() => resolve()))
    const { fetchClient } = setup(baseUrl)
    await expect(fetchClient.GET('/users/languages')).rejects.toMatchObject({
      kind: 'network',
      status: 0,
      code: 'client.network',
    })
  })

  it('maps a response slower than timeoutMs to kind timeout', async () => {
    const { baseUrl } = await serve({ status: 200, delayMs: 200 })
    const { fetchClient } = setup(baseUrl, { timeoutMs: 50 })
    await expect(fetchClient.GET('/users/languages')).rejects.toMatchObject({
      kind: 'timeout',
      status: 0,
      code: 'client.timeout',
    })
  })

  it('survives a plain-text error body from the gateway', async () => {
    const { baseUrl } = await serve({
      status: 502,
      body: 'Bad Gateway',
      headers: { 'content-type': 'text/plain' },
    })
    const { fetchClient } = setup(baseUrl)
    await expect(fetchClient.GET('/users/languages')).rejects.toMatchObject({
      kind: 'http',
      status: 502,
      code: 'client.unexpected_response',
    })
  })

  it('calls onUnauthorized for a 401 auth.unauthenticated on any path, not for another code', async () => {
    const unauthenticated = await serve({ status: 401, body: envelope('auth.unauthenticated') })
    const first = setup(unauthenticated.baseUrl)
    await expect(first.fetchClient.GET('/users/me')).rejects.toMatchObject({ status: 401 })
    expect(first.onUnauthorized).toHaveBeenCalledTimes(1)

    const other = await serve({ status: 401, body: envelope('auth.token_revoked') })
    const second = setup(other.baseUrl)
    await expect(second.fetchClient.GET('/users/me')).rejects.toMatchObject({
      status: 401,
      code: 'auth.token_revoked',
    })
    expect(second.onUnauthorized).not.toHaveBeenCalled()
  })

  it('rejects with the original abort error when the caller aborts', async () => {
    const { baseUrl } = await serve({ status: 200, delayMs: 200 })
    const { fetchClient } = setup(baseUrl)
    const controller = new AbortController()
    const call = fetchClient.GET('/users/languages', { signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    const error = await call.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ name: 'AbortError' })
  })

  it('does not end a newer session when a request sent with an old token answers 401', async () => {
    const { baseUrl } = await serve({
      status: 401,
      body: envelope('auth.unauthenticated'),
      delayMs: 100,
    })
    let token: string | null = 'old'
    const { fetchClient, onUnauthorized } = setup(baseUrl, { getToken: () => token })
    const call = fetchClient.GET('/users/languages')
    token = 'new'
    await expect(call).rejects.toMatchObject({ status: 401, code: 'auth.unauthenticated' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('calls onUnauthorized once when two requests with the same token answer 401', async () => {
    const { baseUrl } = await serve({
      status: 401,
      body: envelope('auth.unauthenticated'),
      delayMs: 50,
    })
    let token: string | null = 'tkn'
    const { fetchClient, onUnauthorized } = setup(baseUrl, {
      getToken: () => token,
      onUnauthorized: () => {
        token = null
      },
    })
    const results = await Promise.allSettled([
      fetchClient.GET('/users/languages'),
      fetchClient.GET('/users/me'),
    ])
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected'])
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
