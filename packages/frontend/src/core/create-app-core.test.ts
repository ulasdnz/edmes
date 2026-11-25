import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MutationObserver } from '@tanstack/react-query'
import { Server } from 'socket.io'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionStatus } from '../session'
import { type AppCore, createAppCore } from '.'

type Reply = (res: ServerResponse) => void

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
async function startBackend(routes: Record<string, Reply[]>) {
  const requests: string[] = []
  const counts = new Map<string, number>()
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume()
    const route = `${req.method} ${req.url?.split('?')[0]}`
    requests.push(route)
    const replies = routes[route]
    if (!replies) {
      json(res, 404, { error: { code: 'not_found', message: 'not_found' } })
      return
    }
    const index = counts.get(route) ?? 0
    counts.set(route, index + 1)
    replies[Math.min(index, replies.length - 1)]?.(res)
  })
  const io = new Server(http, { transports: ['websocket'] })
  io.on('connection', socket => {
    socket.on('join', (data: { rooms?: unknown[] }, ack?: (res: { rooms: string[] }) => void) => {
      const rooms = data?.rooms
      if (!Array.isArray(rooms)) return
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room)
      }
      const allowed = rooms.filter((room): room is string => typeof room === 'string')
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
  return { url, emit, members, requests, count }
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

function build(url: string, options: { heartbeatMs?: number } = {}): AppCore {
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
})
