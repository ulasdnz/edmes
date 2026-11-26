import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MutationObserver } from '@tanstack/react-query'
import { Server } from 'socket.io'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionStatus } from '../session'
import { type AppCore, type AppCoreOptions, createAppCore } from '.'

type Reply = (res: ServerResponse, req: IncomingMessage) => void

const cleanups: Array<() => unknown> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const user = (roles: string[]) => ({
  _id: '0123456789abcdef01234567',
  username: 'ada',
  email: 'ada@example.com',
  name: 'Ada',
  surname: 'Lovelace',
  roles,
  language: 'en',
  workCenterIds: [],
  specialities: [],
  props: {},
  isActivated: true,
  isActiveDirectoryUser: false,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const ok =
  (roles: string[] = ['r1']): Reply =>
  res =>
    json(res, 200, {
      data: user(roles),
      meta: {
        plantTimezone: 'Europe/Istanbul',
        serverTime: '2026-11-25T10:00:00.000Z',
        permissions: ['readUsers'],
      },
    })
const errorReply =
  (status: number, code: string): Reply =>
  res =>
    json(res, status, { error: { code, message: code } })
const unauthenticated = errorReply(401, 'auth.unauthenticated')
const unavailable = errorReply(503, 'auth.unavailable')
const dropped: Reply = res => res.destroy()

// One node:http server answers the REST calls by "METHOD path" from a script per route, and
// carries a socket.io server on /socket.io the way the gateway sits behind the same origin.
async function startBackend(
  routes: Record<string, Reply[]>,
  gateway: { reject?: () => string | undefined; deny?: readonly string[] } = {},
) {
  const requests: string[] = []
  const counts = new Map<string, number>()
  const concurrency = { inFlight: 0, max: 0 }
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume()
    const route = `${req.method} ${req.url?.split('?')[0]}`
    requests.push(route)
    concurrency.inFlight++
    concurrency.max = Math.max(concurrency.max, concurrency.inFlight)
    res.on('close', () => concurrency.inFlight--)
    const replies = routes[route]
    if (!replies) {
      json(res, 404, { error: { code: 'not_found', message: 'not_found' } })
      return
    }
    const index = counts.get(route) ?? 0
    counts.set(route, index + 1)
    replies[Math.min(index, replies.length - 1)]?.(res, req)
  })
  const io = new Server(http, { transports: ['websocket'] })
  // the token of every socket connection, in order
  const socketTokens: unknown[] = []
  io.use((_socket, next) => {
    const message = gateway.reject?.()
    next(message ? new Error(message) : undefined)
  })
  io.on('connection', socket => {
    socketTokens.push(socket.handshake.auth.token)
    socket.on('join', (data: { rooms?: unknown[] }, ack?: (res: { rooms: string[] }) => void) => {
      const rooms = data?.rooms
      if (!Array.isArray(rooms)) return
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room)
      }
      const allowed = rooms.filter(
        (room): room is string => typeof room === 'string' && !gateway.deny?.includes(room),
      )
      for (const room of allowed) socket.join(room)
      if (typeof ack === 'function') ack({ rooms: allowed })
    })
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => io.close())
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  const count = (route: string) => requests.filter(r => r === route).length
  // as the gateway does: an event goes to the room of its entity
  const emit = (type: string, payload: Record<string, unknown>) =>
    io.to(type.split('.')[0] ?? '').emit(type, payload)
  const members = (room: string) => io.sockets.adapter.rooms.get(room)?.size ?? 0
  return { url, emit, members, requests, count, concurrency, socketTokens }
}

function memoryStorage(token?: string) {
  const map = new Map<string, string>()
  if (token) map.set('edmes.web.token', token)
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  } satisfies Storage
}

function build(
  url: string,
  options: Partial<
    Pick<AppCoreOptions, 'app' | 'heartbeatMs' | 'storage' | 'storageEvents' | 'onRoomsDenied'>
  > = {},
): AppCore {
  const core = createAppCore({
    app: 'web',
    storage: memoryStorage('tkn'),
    getLocale: () => 'en',
    apiBaseUrl: url,
    realtimeUrl: url,
    ...options,
  })
  cleanups.push(() => {
    core.session.logout()
  })
  return core
}

function track(core: AppCore) {
  const statuses: SessionStatus[] = []
  core.session.subscribe(state => {
    if (statuses.at(-1) !== state.status) statuses.push(state.status)
  })
  return statuses
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('app core', () => {
  it('clears cached data when the session ends by logout', async () => {
    const backend = await startBackend({ 'GET /users/me': [ok()] })
    const core = build(backend.url)
    await core.session.bootstrap()
    await vi.waitFor(() => expect(core.realtime.getStatus()).toBe('live'))
    core.queryClient.setQueryData(['get', '/users', {}], { data: ['previous user data'] })
    core.session.logout()
    expect(core.queryClient.getQueryCache().getAll()).toEqual([])
    expect(core.realtime.getStatus()).toBe('idle')
  })

  it('clears cached data when a request answers 401', async () => {
    const backend = await startBackend({
      'GET /users/me': [ok()],
      'GET /users': [unauthenticated],
    })
    const core = build(backend.url)
    await core.session.bootstrap()
    core.queryClient.setQueryData(['get', '/roles', {}], { data: ['previous user data'] })
    await core.queryClient
      .fetchQuery(core.api.$api.queryOptions('get', '/users'))
      .catch(() => undefined)
    expect(core.session.getState().status).toBe('anonymous')
    expect(core.queryClient.getQueryData(['get', '/roles', {}])).toBeUndefined()
    expect(core.realtime.getStatus()).toBe('idle')
  })

  it("refreshes the session when one of the user's roles changes", async () => {
    const backend = await startBackend({ 'GET /users/me': [ok(['r1'])] })
    const core = build(backend.url)
    await core.session.bootstrap()
    await vi.waitFor(() => {
      expect(backend.members('role')).toBe(1)
      expect(backend.members('user')).toBe(1)
    })
    expect(backend.count('GET /users/me')).toBe(1)

    backend.emit('role.updated', { roleId: 'r2' })
    backend.emit('user.updated', { userId: 'someone-else' })
    backend.emit('role.updated', { roleId: 'r1' })
    await vi.waitFor(() => expect(backend.count('GET /users/me')).toBe(2))

    backend.emit('user.updated', { userId: '0123456789abcdef01234567' })
    await vi.waitFor(() => expect(backend.count('GET /users/me')).toBe(3))
    await sleep(100)
    expect(backend.count('GET /users/me')).toBe(3)
  })

  it('notices an outage and the recovery by itself', async () => {
    const backend = await startBackend({
      'GET /users/me': [ok(), unavailable, unavailable, ok()],
    })
    const core = build(backend.url, { heartbeatMs: 50 })
    const statuses = track(core)
    await core.session.bootstrap()
    await vi.waitFor(() => expect(backend.count('GET /users/me')).toBeGreaterThanOrEqual(4))
    await vi.waitFor(() => expect(core.session.getState().status).toBe('authenticated'))
    expect(statuses).toEqual(['authenticated', 'unreachable', 'authenticated'])
  })

  it('ends the session when the heartbeat gets a 401', async () => {
    const backend = await startBackend({ 'GET /users/me': [ok(), unauthenticated] })
    const core = build(backend.url, { heartbeatMs: 50 })
    await core.session.bootstrap()
    expect(core.session.getState().status).toBe('authenticated')
    await vi.waitFor(() => expect(core.session.getState().status).toBe('anonymous'))
    const requests = backend.count('GET /users/me')
    await sleep(200)
    expect(backend.count('GET /users/me')).toBe(requests)
  })

  it('sends one heartbeat at a time when /users/me is slow', async () => {
    const slow: Reply = (res, req) => {
      const timer = setTimeout(() => ok()(res, req), 150)
      res.on('close', () => clearTimeout(timer))
    }
    const backend = await startBackend({ 'GET /users/me': [ok(), slow] })
    const core = build(backend.url, { heartbeatMs: 30 })
    await core.session.bootstrap()
    await vi.waitFor(() => expect(backend.count('GET /users/me')).toBeGreaterThanOrEqual(3), {
      timeout: 2000,
    })
    expect(backend.concurrency.max).toBe(1)
  })

  it.each([
    ['a 500', errorReply(500, 'error.internal')],
    ['a dropped connection', dropped],
  ])('never retries a mutation that fails with %s', async (_name, failure) => {
    const backend = await startBackend({ 'POST /auth/login': [failure] })
    const core = build(backend.url)
    const observer = new MutationObserver(core.queryClient, {
      mutationFn: () =>
        core.api.fetchClient.POST('/auth/login', { body: { email: 'a@b.co', password: 'pw' } }),
    })
    await expect(observer.mutate()).rejects.toMatchObject({ name: 'ApiError' })
    await sleep(100)
    expect(backend.count('POST /auth/login')).toBe(1)
  })

  it('retries a query twice on a network failure and never on an http error', async () => {
    const backend = await startBackend({
      'GET /users': [dropped],
      'GET /roles': [unavailable],
    })
    const core = build(backend.url)
    await expect(
      core.queryClient.fetchQuery({
        ...core.api.$api.queryOptions('get', '/users'),
        retryDelay: 0,
      }),
    ).rejects.toMatchObject({ kind: 'network' })
    expect(backend.count('GET /users')).toBe(3)
    await expect(
      core.queryClient.fetchQuery({
        ...core.api.$api.queryOptions('get', '/roles'),
        retryDelay: 0,
      }),
    ).rejects.toMatchObject({ kind: 'http', status: 503 })
    expect(backend.count('GET /roles')).toBe(1)
  })

  describe('another tab', () => {
    const grace = { ...user(['r9']), _id: 'fedcba9876543210fedcba98', email: 'grace@example.com' }
    // The answer to /users/me depends on the token it carries, as user-service's does
    const byToken: Reply = (res, req) => {
      const token = req.headers.authorization?.replace('Bearer ', '')
      if (token === 'tkn') ok()(res, req)
      else if (token === 'tkn2') {
        json(res, 200, {
          data: grace,
          meta: {
            plantTimezone: 'Europe/Istanbul',
            serverTime: '2026-11-25T10:00:00.000Z',
            permissions: ['writeUsers'],
          },
        })
      } else unauthenticated(res, req)
    }

    // What the browser dispatches in this tab when another tab changes the shared storage
    const storageEvent = (storageArea: Storage, key: string | null, newValue: string | null) =>
      Object.assign(new Event('storage'), { key, newValue, storageArea })

    async function signedIn(options: { heartbeatMs?: number } = {}) {
      const backend = await startBackend({ 'GET /users/me': [byToken] })
      const storage = memoryStorage('tkn')
      const storageEvents = new EventTarget()
      const core = build(backend.url, { storage, storageEvents, ...options })
      await core.session.bootstrap()
      await vi.waitFor(() => {
        expect(core.realtime.getStatus()).toBe('live')
        expect(backend.members('role')).toBe(1)
      })
      core.queryClient.setQueryData(['get', '/users', {}], { data: ['previous user data'] })
      return { backend, storage, storageEvents, core }
    }

    it('signs this tab out when another tab signs out', async () => {
      const { backend, storage, storageEvents, core } = await signedIn()
      storage.removeItem('edmes.web.token')
      storageEvents.dispatchEvent(storageEvent(storage, 'edmes.web.token', null))
      await vi.waitFor(() => expect(core.session.getState().status).toBe('anonymous'))
      expect(core.session.getState()).toMatchObject({ user: null, permissions: [] })
      expect(core.queryClient.getQueryCache().getAll()).toEqual([])
      expect(core.realtime.getStatus()).toBe('idle')
      expect(backend.count('GET /users/me')).toBe(1)
    })

    it('signs this tab out when another tab clears the storage', async () => {
      const { storage, storageEvents, core } = await signedIn()
      storage.clear()
      storageEvents.dispatchEvent(storageEvent(storage, null, null))
      await vi.waitFor(() => expect(core.session.getState().status).toBe('anonymous'))
      expect(core.realtime.getStatus()).toBe('idle')
    })

    it('takes the user another tab signed in, with fresh data and rooms joined as that user', async () => {
      const { backend, storage, storageEvents, core } = await signedIn()
      storage.setItem('edmes.web.token', 'tkn2')
      storageEvents.dispatchEvent(storageEvent(storage, 'edmes.web.token', 'tkn2'))
      await vi.waitFor(() => expect(core.session.getState().user?.email).toBe('grace@example.com'))
      expect(core.session.getState()).toMatchObject({
        status: 'authenticated',
        permissions: ['writeUsers'],
      })
      // nothing read with the first user's token stays on screen
      expect(core.queryClient.getQueryData(['get', '/users', {}])).toBeUndefined()
      await vi.waitFor(() => {
        expect(backend.socketTokens).toEqual(['tkn', 'tkn2'])
        expect(core.realtime.getStatus()).toBe('live')
        expect(backend.members('role')).toBe(1)
        expect(backend.members('user')).toBe(1)
      })
    })

    it('ignores a storage event for another key or another storage', async () => {
      const { backend, storage, storageEvents, core } = await signedIn()
      storageEvents.dispatchEvent(storageEvent(storage, 'edmes.operator.token', null))
      storageEvents.dispatchEvent(storageEvent(memoryStorage(), 'edmes.web.token', null))
      await sleep(100)
      expect(backend.count('GET /users/me')).toBe(1)
      expect(core.session.getState().status).toBe('authenticated')
    })

    it('ends the session at the next heartbeat when the token went without an event', async () => {
      const { backend, storage, core } = await signedIn({ heartbeatMs: 50 })
      storage.removeItem('edmes.web.token')
      await vi.waitFor(() => expect(core.session.getState().status).toBe('anonymous'))
      expect(core.realtime.getStatus()).toBe('idle')
      expect(core.queryClient.getQueryCache().getAll()).toEqual([])
      // a heartbeat without a token asks nothing, and the heartbeat stops
      const asked = backend.count('GET /users/me')
      await sleep(150)
      expect(backend.count('GET /users/me')).toBe(asked)
    })

    // scenario: AppCore.sessionAndRealtime / authorization / another tab removes edmes.web.token
    it('signs this tab out, clears the cache and stops realtime without asking the server', async () => {
      for (const change of ['key removed', 'storage cleared'] as const) {
        const { backend, storage, storageEvents, core } = await signedIn()
        if (change === 'key removed') {
          storage.removeItem('edmes.web.token')
          storageEvents.dispatchEvent(storageEvent(storage, 'edmes.web.token', null))
        } else {
          storage.clear()
          storageEvents.dispatchEvent(storageEvent(storage, null, null))
        }
        await vi.waitFor(() => expect(core.session.getState().status).toBe('anonymous'))
        expect(core.session.getState()).toMatchObject({ user: null, permissions: [] })
        expect(core.queryClient.getQueryCache().getAll()).toEqual([])
        expect(core.realtime.getStatus()).toBe('idle')
        expect(backend.count('GET /users/me')).toBe(1)
      }
    })
  })
})

describe('app core scenarios', () => {
  const ownId = '0123456789abcdef01234567'

  async function signedIn(roles: string[] = ['r1']) {
    const backend = await startBackend({ 'GET /users/me': [ok(roles)] })
    const core = build(backend.url)
    await core.session.bootstrap()
    await vi.waitFor(() => {
      expect(core.realtime.getStatus()).toBe('live')
      expect(backend.members('role')).toBe(1)
      expect(backend.members('user')).toBe(1)
    })
    expect(backend.count('GET /users/me')).toBe(1)
    return { backend, core }
  }

  // scenario: AppCore.sessionAndRealtime / happy path / the session becomes authenticated
  it('starts the realtime client when the session becomes authenticated', async () => {
    const backend = await startBackend({ 'GET /users/me': [ok()] })
    const core = build(backend.url)
    expect(core.realtime.getStatus()).toBe('idle')
    await core.session.bootstrap()
    expect(core.session.getState().status).toBe('authenticated')
    expect(core.realtime.getStatus()).not.toBe('idle')
    await vi.waitFor(() => expect(core.realtime.getStatus()).toBe('live'))
    expect(backend.socketTokens).toEqual(['tkn'])
  })

  // scenario: AppCore.sessionAndRealtime / happy path / any other role.* event about one of the user's roles
  it("refreshes the session on role.created and role.deleted for one of the user's roles", async () => {
    const { backend } = await signedIn(['r1'])
    backend.emit('role.created', { roleId: 'r1' })
    await vi.waitFor(() => expect(backend.count('GET /users/me')).toBe(2))
    backend.emit('role.deleted', { roleId: 'r1' })
    await vi.waitFor(() => expect(backend.count('GET /users/me')).toBe(3))
  })

  // scenario: AppCore.sessionAndRealtime / happy path / user.updated for the signed-in user
  it('refreshes the session when the signed-in user is updated', async () => {
    const { backend } = await signedIn()
    backend.emit('user.updated', { userId: ownId })
    await vi.waitFor(() => expect(backend.count('GET /users/me')).toBe(2))
  })

  // scenario: AppCore.sessionAndRealtime / happy path / query defaults
  it('keeps query data fresh for 30 seconds by default', () => {
    const core = build('http://127.0.0.1:9')
    expect(core.queryClient.getDefaultOptions().queries?.staleTime).toBe(30000)
  })

  // scenario: AppCore.sessionAndRealtime / constraints / role.updated for a role the user does not hold
  it('does not refresh the session when a role the user does not hold changes', async () => {
    const { backend, core } = await signedIn(['r1'])
    const delivered: Array<Record<string, unknown>> = []
    core.realtime.on('role.updated', payload => delivered.push(payload))
    backend.emit('role.updated', { roleId: 'r2' })
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    await sleep(100)
    expect(backend.count('GET /users/me')).toBe(1)
  })

  // scenario: AppCore.sessionAndRealtime / constraints / user.updated for another user
  it('does not refresh the session when another user is updated', async () => {
    const { backend, core } = await signedIn()
    const delivered: Array<Record<string, unknown>> = []
    core.realtime.on('user.updated', payload => delivered.push(payload))
    backend.emit('user.updated', { userId: 'fedcba9876543210fedcba98' })
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    await sleep(100)
    expect(backend.count('GET /users/me')).toBe(1)
  })

  // scenario: AppCore.sessionAndRealtime / constraints / status anonymous
  it('sends no heartbeat while the session is anonymous', async () => {
    const backend = await startBackend({ 'GET /users/me': [ok()] })
    const neverSignedIn = build(backend.url, { heartbeatMs: 50, storage: memoryStorage() })
    await neverSignedIn.session.bootstrap()
    expect(neverSignedIn.session.getState().status).toBe('anonymous')
    await sleep(200)
    expect(backend.count('GET /users/me')).toBe(0)

    const signedOut = build(backend.url, { heartbeatMs: 50 })
    await signedOut.session.bootstrap()
    expect(backend.count('GET /users/me')).toBe(1)
    signedOut.session.logout()
    expect(signedOut.session.getState().status).toBe('anonymous')
    await sleep(200)
    expect(backend.count('GET /users/me')).toBe(1)
  })

  // scenario: AppCore.sessionAndRealtime / constraints / a query fails with kind 'http'
  it('does not retry a query that fails with an http error', async () => {
    const backend = await startBackend({ 'GET /roles': [errorReply(500, 'error.internal')] })
    const core = build(backend.url)
    await expect(
      core.queryClient.fetchQuery({
        ...core.api.$api.queryOptions('get', '/roles'),
        retryDelay: 0,
      }),
    ).rejects.toMatchObject({ kind: 'http', status: 500 })
    await sleep(50)
    expect(backend.count('GET /roles')).toBe(1)
  })

  // A /users answer that comes only after a second; a client that gives up closes the request.
  const late: Reply = res => {
    const timer = setTimeout(() => json(res, 200, { data: [] }), 1000)
    res.on('close', () => clearTimeout(timer))
  }

  // scenario: AppCore.sessionAndRealtime / constraints / a query fails with kind 'network' or 'timeout'
  it('retries a query twice when it fails with a network error or a timeout', async () => {
    const backend = await startBackend({ 'GET /roles': [dropped], 'GET /users': [late] })
    const core = build(backend.url)
    await expect(
      core.queryClient.fetchQuery({
        ...core.api.$api.queryOptions('get', '/roles'),
        retryDelay: 0,
      }),
    ).rejects.toMatchObject({ kind: 'network' })
    expect(backend.count('GET /roles')).toBe(3)

    let calls = 0
    await expect(
      core.queryClient.fetchQuery({
        queryKey: ['get', '/users', { timeout: true }],
        queryFn: async () => {
          calls++
          const { data } = await core.api.fetchClient.GET('/users', {
            signal: AbortSignal.timeout(50),
          })
          return data
        },
        retryDelay: 0,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' })
    expect(calls).toBe(3)
  })

  // scenario: AppCore.sessionAndRealtime / constraints / a query fails with kind 'aborted'
  it('does not retry a query whose request was aborted', async () => {
    const backend = await startBackend({ 'GET /users': [late] })
    const core = build(backend.url)
    let calls = 0
    await expect(
      core.queryClient.fetchQuery({
        queryKey: ['get', '/users', { aborted: true }],
        queryFn: async () => {
          calls++
          const controller = new AbortController()
          setTimeout(() => controller.abort(), 20)
          const { data } = await core.api.fetchClient.GET('/users', { signal: controller.signal })
          return data
        },
        retryDelay: 0,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await sleep(50)
    expect(calls).toBe(1)
  })

  // scenario: AppCore.sessionAndRealtime / constraints / createAppCore({ onRoomsDenied })
  it('reports the rooms the gateway refused through onRoomsDenied', async () => {
    const backend = await startBackend({ 'GET /users/me': [ok()] }, { deny: ['wc:x'] })
    const onRoomsDenied = vi.fn()
    const core = build(backend.url, { onRoomsDenied })
    await core.session.bootstrap()
    await vi.waitFor(() => expect(core.realtime.getStatus()).toBe('live'))
    core.realtime.subscribe(['job_order', 'wc:x'])
    await vi.waitFor(() => expect(onRoomsDenied).toHaveBeenCalledWith(['wc:x']))
    expect(onRoomsDenied).toHaveBeenCalledTimes(1)
  })

  // scenario: AppCore.sessionAndRealtime / authorization / app 'web' and app 'operator' token keys
  it('keeps the web token under edmes.web.token and the operator token under edmes.operator.token', async () => {
    const loginOk: Reply = res =>
      json(res, 200, { data: { token: 'tkn', user: user(['r1']) }, message: 'Signed in' })
    const backend = await startBackend({ 'POST /auth/login': [loginOk], 'GET /users/me': [ok()] })
    const credentials = { email: 'ada@example.com', password: 'pw' }

    const webStorage = memoryStorage()
    const web = build(backend.url, { app: 'web', storage: webStorage })
    await web.session.login(credentials)
    expect(webStorage.getItem('edmes.web.token')).toBe('tkn')
    expect(webStorage.getItem('edmes.operator.token')).toBeNull()

    const operatorStorage = memoryStorage()
    const operator = build(backend.url, { app: 'operator', storage: operatorStorage })
    await operator.session.login(credentials)
    expect(operatorStorage.getItem('edmes.operator.token')).toBe('tkn')
    expect(operatorStorage.getItem('edmes.web.token')).toBeNull()
  })

  // scenario: AppCore.sessionAndRealtime / authorization / the session ends (logout() or a 401)
  it('clears every cached query and stops realtime when the session ends by logout or by a 401', async () => {
    const backend = await startBackend({
      'GET /users/me': [ok()],
      'GET /users': [unauthenticated],
    })
    const withData = (core: AppCore) =>
      core.queryClient
        .getQueryCache()
        .getAll()
        .filter(query => query.state.data !== undefined)

    const loggedOut = build(backend.url)
    await loggedOut.session.bootstrap()
    await vi.waitFor(() => expect(loggedOut.realtime.getStatus()).toBe('live'))
    loggedOut.queryClient.setQueryData(['get', '/roles', {}], { data: ['previous user data'] })
    loggedOut.session.logout()
    expect(withData(loggedOut)).toEqual([])
    expect(loggedOut.realtime.getStatus()).toBe('idle')

    const expired = build(backend.url)
    await expired.session.bootstrap()
    await vi.waitFor(() => expect(expired.realtime.getStatus()).toBe('live'))
    expired.queryClient.setQueryData(['get', '/roles', {}], { data: ['previous user data'] })
    await expired.queryClient
      .fetchQuery(expired.api.$api.queryOptions('get', '/users'))
      .catch(() => undefined)
    expect(expired.session.getState().status).toBe('anonymous')
    expect(withData(expired)).toEqual([])
    expect(expired.realtime.getStatus()).toBe('idle')
  })

  // scenario: AppCore.sessionAndRealtime / authorization / the realtime client reports auth.unauthenticated
  it('signs out when the realtime gateway answers auth.unauthenticated', async () => {
    const backend = await startBackend(
      { 'GET /users/me': [ok()] },
      { reject: () => 'auth.unauthenticated' },
    )
    const storage = memoryStorage('tkn')
    const core = build(backend.url, { storage })
    await core.session.bootstrap()
    await vi.waitFor(() => expect(core.session.getState().status).toBe('anonymous'))
    expect(storage.getItem('edmes.web.token')).toBeNull()
    expect(core.realtime.getStatus()).toBe('idle')
  })
})
