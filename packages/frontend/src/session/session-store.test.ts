import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApiClient } from '@mes/api-client'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionStore, type SessionStore, type TokenStorageKey } from './session-store'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
type Reply = (res: ServerResponse) => void

const servers: Server[] = []

async function listen(handler: Handler) {
  const server = createServer((req, res) => {
    req.resume()
    handler(req, res)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const errorBody = (code: string) => ({ error: { code, message: code } })

const user = {
  _id: '0123456789abcdef01234567',
  username: 'ada',
  email: 'ada@example.com',
  name: 'Ada',
  surname: 'Lovelace',
  roles: [],
  language: 'en',
  workCenterIds: [],
  specialities: [],
  props: {},
  isActivated: true,
  isActiveDirectoryUser: false,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const me = (permissions: string[], serverTime: string) => ({
  data: user,
  meta: { plantTimezone: 'Europe/Istanbul', serverTime, permissions },
})

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

function clientFor(baseUrl: string, store: SessionStore) {
  return createApiClient({
    baseUrl,
    getToken: store.getToken,
    getLocale: () => 'en',
    onUnauthorized: store.logout,
  })
}

function build(baseUrl: string, options: { key?: TokenStorageKey; token?: string } = {}) {
  const key = options.key ?? 'edmes.web.token'
  const storage = memoryStorage()
  if (options.token) storage.setItem(key, options.token)
  const store: SessionStore = createSessionStore({ storageKey: key, storage, api: () => api })
  const api = clientFor(baseUrl, store)
  return { store, storage, baseUrl }
}

function scripted(replies: Reply[]) {
  const requests: string[] = []
  let index = 0
  const handler: Handler = (req, res) => {
    requests.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`)
    replies[Math.min(index++, replies.length - 1)]?.(res)
  }
  return { handler, requests }
}

const ok =
  (permissions = ['readUsers'], serverTime = '2026-11-25T10:00:00.000Z'): Reply =>
  res =>
    json(res, 200, me(permissions, serverTime))
const unauthenticated: Reply = res => json(res, 401, errorBody('auth.unauthenticated'))
const unavailable: Reply = res => json(res, 503, errorBody('auth.unavailable'))
const gatewayHtml: Reply = res => {
  res.writeHead(404, { 'content-type': 'text/html' })
  res.end('<html>not found</html>')
}
const dropped: Reply = res => res.destroy()

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

describe('session store', () => {
  it('is anonymous without a stored token and makes no request', async () => {
    const { handler, requests } = scripted([ok()])
    const { store } = build(await listen(handler))
    await store.bootstrap()
    expect(store.getState()).toMatchObject({ status: 'anonymous', user: null, permissions: [] })
    expect(requests).toEqual([])
  })

  it('becomes authenticated from a stored token', async () => {
    const { handler, requests } = scripted([ok()])
    const { store } = build(await listen(handler), { token: 'tkn' })
    expect(store.getState().status).toBe('unknown')
    await store.bootstrap()
    expect(store.getState()).toMatchObject({
      status: 'authenticated',
      plantTimezone: 'Europe/Istanbul',
      permissions: ['readUsers'],
    })
    expect(store.getState().user?.email).toBe('ada@example.com')
    expect(store.getState().serverClock?.toIso()).toMatch(/^2026-11-25T10:00:0/)
    expect(requests).toEqual(['GET /users/me Bearer tkn'])
  })

  it('drops the token on 401', async () => {
    const { handler } = scripted([unauthenticated])
    const { store, storage } = build(await listen(handler), { token: 'tkn' })
    await store.bootstrap()
    expect(store.getState().status).toBe('anonymous')
    expect(storage.getItem('edmes.web.token')).toBeNull()
  })

  it('keeps the token when user-service answers 503 auth.unavailable', async () => {
    const { handler } = scripted([unavailable])
    const { store, storage } = build(await listen(handler), { token: 'tkn' })
    await store.bootstrap()
    expect(store.getState().status).toBe('unreachable')
    expect(storage.getItem('edmes.web.token')).toBe('tkn')
  })

  it('keeps the token when the server cannot be reached', async () => {
    const baseUrl = await listen(() => {})
    await new Promise<void>(resolve => servers[0]?.close(() => resolve()))
    const { store, storage } = build(baseUrl, { token: 'tkn' })
    await store.bootstrap()
    expect(store.getState().status).toBe('unreachable')
    expect(storage.getItem('edmes.web.token')).toBe('tkn')
  })

  it('recovers from unreachable on the next bootstrap', async () => {
    const { handler } = scripted([unavailable, ok()])
    const { store } = build(await listen(handler), { token: 'tkn' })
    await store.bootstrap()
    expect(store.getState().status).toBe('unreachable')
    await store.bootstrap()
    expect(store.getState().status).toBe('authenticated')
  })

  it('stores the token under its own key only', async () => {
    const { handler } = scripted([res => json(res, 200, { data: { user, token: 'tkn' } }), ok()])
    const { store, storage } = build(await listen(handler), { key: 'edmes.operator.token' })
    await store.login({ email: 'ada@example.com', password: 'pw' })
    expect(storage.getItem('edmes.operator.token')).toBe('tkn')
    expect(storage.getItem('edmes.web.token')).toBeNull()
    expect(store.getState().status).toBe('authenticated')
  })

  it('rejects a wrong password and stores nothing', async () => {
    const { handler } = scripted([res => json(res, 401, errorBody('auth.invalid_credentials'))])
    const { store, storage } = build(await listen(handler))
    await store.bootstrap()
    await expect(store.login({ email: 'a@b.co', password: 'bad' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'auth.invalid_credentials',
    })
    expect(store.getState().status).toBe('anonymous')
    expect(storage.getItem('edmes.web.token')).toBeNull()
  })

  it('surfaces the lockout code', async () => {
    const { handler } = scripted([
      res => json(res, 429, errorBody('auth.account_temporarily_locked')),
    ])
    const { store, storage } = build(await listen(handler))
    await expect(store.login({ email: 'a@b.co', password: 'bad' })).rejects.toMatchObject({
      status: 429,
      code: 'auth.account_temporarily_locked',
    })
    expect(storage.getItem('edmes.web.token')).toBeNull()
  })

  it('ends the session when a later request returns 401', async () => {
    const { handler } = scripted([ok(), unauthenticated])
    const { store, storage, baseUrl } = build(await listen(handler), { token: 'tkn' })
    await store.bootstrap()
    expect(store.getState().status).toBe('authenticated')
    await clientFor(baseUrl, store)
      .fetchClient.GET('/users/me')
      .catch(() => undefined)
    expect(store.getState()).toMatchObject({ status: 'anonymous', user: null, permissions: [] })
    expect(storage.getItem('edmes.web.token')).toBeNull()
  })

  it('ends the session when a refresh returns 401', async () => {
    const { handler } = scripted([ok(), unauthenticated])
    const { store, storage } = build(await listen(handler), { token: 'tkn' })
    await store.bootstrap()
    await store.refresh()
    expect(store.getState()).toMatchObject({ status: 'anonymous', user: null, permissions: [] })
    expect(storage.getItem('edmes.web.token')).toBeNull()
  })

  it('grants a held permission, refuses a missing one and honours the wildcard', async () => {
    const held = build(await listen(scripted([ok(['readUsers'])]).handler), { token: 'tkn' })
    await held.store.bootstrap()
    expect(held.store.can('readUsers')).toBe(true)
    expect(held.store.can('writeUsers')).toBe(false)

    const wild = build(await listen(scripted([ok(['*'])]).handler), { token: 'tkn' })
    await wild.store.bootstrap()
    expect(wild.store.can('writeUsers')).toBe(true)

    // @ts-expect-error a misspelled privilege code does not compile
    held.store.can('accessUserScreen')
  })

  it('picks up changed permissions on refresh', async () => {
    const { handler } = scripted([ok(['readUsers']), ok(['readUsers', 'writeUsers'])])
    const { store } = build(await listen(handler), { token: 'tkn' })
    await store.bootstrap()
    expect(store.can('writeUsers')).toBe(false)
    await store.refresh()
    expect(store.can('writeUsers')).toBe(true)
  })

  it('replaces the server clock on every refresh', async () => {
    const { handler } = scripted([
      ok(['readUsers'], '2026-11-25T10:00:00.000Z'),
      ok(['readUsers'], '2030-01-01T00:00:00.000Z'),
    ])
    const { store } = build(await listen(handler), { token: 'tkn' })
    await store.bootstrap()
    expect(store.getState().serverClock?.toIso()).toMatch(/^2026-11-25T10:00:0/)
    await store.refresh()
    expect(store.getState().serverClock?.toIso()).toMatch(/^2030-01-01T00:00:0/)
  })

  it.each([
    ['503', unavailable],
    ['a 404 html page', gatewayHtml],
    ['nothing at all', dropped],
  ])('keeps the user and the permissions when a refresh fails with %s', async (_name, failure) => {
    const { handler } = scripted([ok(['readUsers']), failure, ok(['readUsers'])])
    const { store, storage } = build(await listen(handler), { token: 'tkn' })
    await store.bootstrap()
    await store.refresh()
    expect(store.getState()).toMatchObject({ status: 'unreachable', permissions: ['readUsers'] })
    expect(store.getState().user).not.toBeNull()
    expect(storage.getItem('edmes.web.token')).toBe('tkn')
    await store.refresh()
    expect(store.getState().status).toBe('authenticated')
  })

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { handler } = scripted([ok()])
    const { store } = build(await listen(handler), { token: 'tkn' })
    const seen: string[] = []
    const unsubscribe = store.subscribe(state => seen.push(state.status))
    await store.bootstrap()
    unsubscribe()
    store.logout()
    expect(seen).toEqual(['authenticated'])
  })
})
