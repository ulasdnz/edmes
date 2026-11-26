import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { QueryClient, type QueryKey, QueryObserver } from '@tanstack/react-query'
import { Server, type Socket } from 'socket.io'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRealtimeClient,
  eventWorkCenterIds,
  invalidationMap,
  pathsForEvent,
  queryWorkCenterIds,
  type RealtimeClient,
  type RealtimeStatus,
} from '.'

interface TestServerOptions {
  reject?: (attempt: number, token: unknown) => string | undefined
  deny?: readonly string[]
  ackDelayMs?: number
  log?: string[]
}

const cleanups: Array<() => unknown> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function startServer(options: TestServerOptions = {}) {
  const http = createServer()
  const io = new Server(http, { transports: ['websocket'] })
  const handshakes: unknown[] = []
  const joins: string[][] = []
  const sockets: Socket[] = []

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    handshakes.push(token)
    const message = options.reject?.(handshakes.length, token)
    next(message ? new Error(message) : undefined)
  })

  io.on('connection', socket => {
    sockets.push(socket)
    socket.on('join', (data: { rooms?: unknown[] }, ack?: (res: { rooms: string[] }) => void) => {
      const rooms = data?.rooms
      if (!Array.isArray(rooms)) return
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room)
      }
      const allowed = rooms.filter(
        (room): room is string => typeof room === 'string' && !options.deny?.includes(room),
      )
      for (const room of allowed) socket.join(room)
      joins.push(rooms as string[])
      if (typeof ack !== 'function') return
      const reply = () => {
        options.log?.push('ack')
        ack({ rooms: allowed })
      }
      if (options.ackDelayMs) ackTimers.push(setTimeout(reply, options.ackDelayMs))
      else reply()
    })
  })

  const ackTimers: Array<ReturnType<typeof setTimeout>> = []
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => {
    for (const timer of ackTimers) clearTimeout(timer)
    return io.close()
  })
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  const last = () => sockets[sockets.length - 1] as Socket
  return { url, io, handshakes, joins, sockets, last }
}

type TestServer = Awaited<ReturnType<typeof startServer>>

function setup(
  server: TestServer,
  overrides: Partial<Parameters<typeof createRealtimeClient>[0]> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onUnauthenticated = vi.fn()
  const client = createRealtimeClient({
    url: server.url,
    getToken: () => 'tkn',
    queryClient,
    invalidation: invalidationMap,
    onUnauthenticated,
    retryDelayMs: 50,
    throttleMs: 50,
    ...overrides,
  })
  const statuses: RealtimeStatus[] = []
  const offStatus = client.onStatus(status => statuses.push(status))
  cleanups.push(() => {
    offStatus()
    client.stop()
    queryClient.clear()
  })
  return { client, queryClient, onUnauthenticated, statuses }
}

async function live(client: RealtimeClient) {
  client.start()
  await vi.waitFor(() => expect(client.getStatus()).toBe('live'))
}

// held: every fetch after the first stays in flight until the test ends, so a refetched query
// still reads as invalidated when the test looks at it.
function observe(
  queryClient: QueryClient,
  queryKey: QueryKey,
  meta?: Record<string, unknown>,
  held = false,
) {
  const counter = { calls: 0 }
  const release: Array<() => void> = []
  cleanups.push(() => {
    for (const resolve of release) resolve()
  })
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => {
      const call = ++counter.calls
      if (held && call > 1) await new Promise<void>(resolve => release.push(resolve))
      return call
    },
    meta,
  })
  const unsubscribe = observer.subscribe(() => {})
  cleanups.push(unsubscribe)
  return counter
}

async function loaded(...counters: Array<{ calls: number }>) {
  await vi.waitFor(() => {
    for (const counter of counters) expect(counter.calls).toBe(1)
  })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('invalidation rules', () => {
  it('maps an event to the paths of its entity', () => {
    expect(pathsForEvent('work_center.shift.started', invalidationMap)).toEqual(['/work-centers'])
    expect(pathsForEvent('role.updated', invalidationMap)).toEqual(['/roles', '/users'])
    expect(pathsForEvent('audit.created', invalidationMap)).toEqual([])
    expect(pathsForEvent('toString.x', invalidationMap)).toEqual([])
  })

  it('reads the work centers an event names', () => {
    expect(
      eventWorkCenterIds({
        workCenterId: 'a',
        previousWorkCenterId: 'b',
        workCenterIds: ['c', 'a'],
      })
        .slice()
        .sort(),
    ).toEqual(['a', 'b', 'c'])
    expect(eventWorkCenterIds({ jobOrderId: 'j1' })).toEqual([])
  })

  it('reads the work centers a query is about', () => {
    expect(queryWorkCenterIds(['get', '/job-orders', {}])).toBeNull()
    expect(queryWorkCenterIds(['get', '/job-orders'])).toBeNull()
    expect(
      queryWorkCenterIds([
        'get',
        '/work-centers/{workCenterId}',
        { params: { path: { workCenterId: 'a' } } },
      ]),
    ).toEqual(['a'])
    expect(
      queryWorkCenterIds(['get', '/job-orders', { params: { query: { workCenterId: 'b' } } }]),
    ).toEqual(['b'])
    expect(
      queryWorkCenterIds(['get', '/job-orders', { params: { query: { workCenterIds: 'c, d' } } }]),
    ).toEqual(['c', 'd'])
  })
})

describe('realtime client', () => {
  it('joins the union of the subscribed rooms', async () => {
    const server = await startServer()
    const { client } = setup(server)
    await live(client)
    await vi.waitFor(() => expect(server.joins).toHaveLength(1))
    client.subscribe(['wc:a'])
    client.subscribe(['wc:b', 'job_order'])
    await vi.waitFor(() => expect(server.joins).toHaveLength(2))
    expect([...(server.joins[1] ?? [])].sort()).toEqual(['job_order', 'wc:a', 'wc:b'])
  })

  it('keeps a room until its last subscriber leaves', async () => {
    const server = await startServer()
    const { client } = setup(server)
    await live(client)
    const leaveA = client.subscribe(['wc:a'])
    const leaveAB = client.subscribe(['wc:a', 'wc:b'])
    await vi.waitFor(() => expect(server.joins.at(-1)?.slice().sort()).toEqual(['wc:a', 'wc:b']))
    leaveAB()
    await vi.waitFor(() => expect(server.joins.at(-1)).toEqual(['wc:a']))
    leaveAB()
    leaveA()
    await vi.waitFor(() => expect(server.joins.at(-1)).toEqual([]))
    expect(server.last().rooms).toEqual(new Set([server.last().id]))
  })

  it('invalidates the queries an event maps to and no others', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server)
    const jobOrdersKey = ['get', '/job-orders', {}]
    const jobOrderKey = ['get', '/job-orders/{id}', { params: { path: { id: 'j1' } } }]
    const usersKey = ['get', '/users', {}]
    const jobOrders = observe(queryClient, jobOrdersKey, undefined, true)
    const jobOrder = observe(queryClient, jobOrderKey, undefined, true)
    const users = observe(queryClient, usersKey, undefined, true)
    await loaded(jobOrders, jobOrder, users)
    await live(client)
    server.io.emit('job_order.started', { jobOrderId: 'j1' })
    await vi.waitFor(() => {
      expect(queryClient.getQueryState(jobOrdersKey)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(jobOrderKey)?.isInvalidated).toBe(true)
    })
    expect(queryClient.getQueryState(usersKey)?.isInvalidated).toBe(false)
    expect([jobOrders.calls, jobOrder.calls, users.calls]).toEqual([2, 2, 1])
  })

  it('refetches only the queries of the work center the event names', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server)
    const keyWc1 = observe(queryClient, [
      'get',
      '/job-orders',
      { params: { query: { workCenterIds: 'wc1' } } },
    ])
    const keyWc23 = observe(queryClient, [
      'get',
      '/job-orders',
      { params: { query: { workCenterIds: 'wc2,wc3' } } },
    ])
    const keyAll = observe(queryClient, ['get', '/job-orders', { params: { query: { page: 1 } } }])
    await loaded(keyWc1, keyWc23, keyAll)
    await live(client)
    server.io.emit('job_order.started', { jobOrderId: 'j1', workCenterId: 'wc2' })
    await vi.waitFor(() => {
      expect(keyWc23.calls).toBe(2)
      expect(keyAll.calls).toBe(2)
    })
    expect({ keyWc1: keyWc1.calls, keyWc23: keyWc23.calls, keyAll: keyAll.calls }).toEqual({
      keyWc1: 1,
      keyWc23: 2,
      keyAll: 2,
    })
  })

  it('treats a moved job order as a change to both work centers', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server)
    const keyWc1 = observe(queryClient, [
      'get',
      '/job-orders',
      { params: { query: { workCenterIds: 'wc1' } } },
    ])
    const keyWc23 = observe(queryClient, [
      'get',
      '/job-orders',
      { params: { query: { workCenterIds: 'wc2,wc3' } } },
    ])
    const keyWc4 = observe(queryClient, [
      'get',
      '/job-orders',
      { params: { query: { workCenterId: 'wc4' } } },
    ])
    await loaded(keyWc1, keyWc23, keyWc4)
    await live(client)
    server.io.emit('job_order.updated', {
      jobOrderId: 'j1',
      workCenterId: 'wc1',
      previousWorkCenterId: 'wc2',
    })
    await vi.waitFor(() => {
      expect(keyWc1.calls).toBe(2)
      expect(keyWc23.calls).toBe(2)
    })
    expect(keyWc4.calls).toBe(1)
  })

  it('collapses a burst of events into two refetches', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server, { throttleMs: 200 })
    const users = observe(queryClient, ['get', '/users', {}])
    await loaded(users)
    await live(client)
    for (let i = 0; i < 10; i++) server.io.emit('user.updated', { userId: `u${i}` })
    await vi.waitFor(() => expect(users.calls).toBe(3))
    await sleep(400)
    expect(users.calls).toBe(3)
  })

  it('never refetches a query that opted out', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server)
    const optedOut = observe(queryClient, ['get', '/users', { params: { query: { page: 2 } } }], {
      realtime: false,
    })
    const users = observe(queryClient, ['get', '/users', {}])
    await loaded(optedOut, users)
    await live(client)
    for (let i = 0; i < 10; i++) server.io.emit('user.updated', { userId: `u${i}` })
    await vi.waitFor(() => expect(users.calls).toBe(3))
    await sleep(150)
    expect(optedOut.calls).toBe(1)
  })

  it('does not fetch a query nobody observes', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server)
    const cachedKey = ['get', '/specialities', {}]
    let cachedCalls = 0
    await queryClient.fetchQuery({ queryKey: cachedKey, queryFn: async () => ++cachedCalls })
    const users = observe(queryClient, ['get', '/users', {}])
    await loaded(users)
    await live(client)
    server.io.emit('speciality.updated', { specialityId: 's1' })
    await vi.waitFor(() => expect(users.calls).toBe(2))
    expect(cachedCalls).toBe(1)
    expect(queryClient.getQueryState(cachedKey)?.isInvalidated).toBe(true)
  })

  it('rejoins and refetches everything on screen after the connection drops', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server)
    const users = observe(queryClient, ['get', '/users', {}])
    const optedOut = observe(queryClient, ['get', '/work-centers', {}], { realtime: false })
    const other = observe(queryClient, ['get', '/reports', {}])
    await loaded(users, optedOut, other)
    client.subscribe(['wc:a', 'job_order'])
    await live(client)
    await vi.waitFor(() =>
      expect(server.joins.at(-1)?.slice().sort()).toEqual(['job_order', 'wc:a']),
    )
    const joinsBefore = server.joins.length
    expect(users.calls).toBe(1)

    server.last().conn.close()
    await vi.waitFor(() => expect(server.sockets).toHaveLength(2), { timeout: 5000 })
    await vi.waitFor(() => {
      expect(server.joins).toHaveLength(joinsBefore + 1)
      expect(users.calls).toBe(2)
      expect(optedOut.calls).toBe(2)
      expect(other.calls).toBe(2)
    })
    expect(server.joins.at(-1)?.slice().sort()).toEqual(['job_order', 'wc:a'])
    expect(client.getStatus()).toBe('live')
  })

  it('reports when the current status began', async () => {
    const server = await startServer()
    const { client, statuses } = setup(server)
    await live(client)
    const liveSince = client.getStatusSince()
    await sleep(5)
    server.last().conn.close()
    await vi.waitFor(() => expect(statuses).toContain('reconnecting'))
    expect(client.getStatusSince().getTime()).toBeGreaterThan(liveSince.getTime())
    await vi.waitFor(() => expect(client.getStatus()).toBe('live'), { timeout: 5000 })
  })

  it('retries at once on retryNow', async () => {
    const server = await startServer({
      reject: attempt => (attempt === 1 ? 'auth.unavailable' : undefined),
    })
    const { client } = setup(server, { retryDelayMs: 60000 })
    client.start()
    await vi.waitFor(() => expect(client.getStatus()).toBe('unavailable'))
    client.retryNow()
    await vi.waitFor(() => expect(client.getStatus()).toBe('live'))
    expect(server.handshakes).toHaveLength(2)
  })

  it('reports auth.unauthenticated and stops connecting', async () => {
    const server = await startServer({ reject: () => 'auth.unauthenticated' })
    const { client, onUnauthenticated } = setup(server, { retryDelayMs: 50 })
    client.start()
    await vi.waitFor(() => expect(onUnauthenticated).toHaveBeenCalledTimes(1))
    await sleep(150)
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
    expect(server.handshakes).toHaveLength(1)
    expect(client.getStatus()).toBe('idle')
  })

  it('stays signed in and retries on auth.unavailable', async () => {
    const server = await startServer({
      reject: attempt => (attempt <= 2 ? 'auth.unavailable' : undefined),
    })
    const { client, onUnauthenticated, statuses } = setup(server, { retryDelayMs: 50 })
    client.start()
    await vi.waitFor(() => expect(client.getStatus()).toBe('live'))
    expect(onUnauthenticated).not.toHaveBeenCalled()
    expect(statuses).toEqual(expect.arrayContaining(['unavailable', 'live']))
    expect(server.handshakes).toHaveLength(3)
  })

  it('reconnects after a server-side disconnect', async () => {
    const server = await startServer()
    const { client } = setup(server)
    await live(client)
    server.last().disconnect(true)
    await vi.waitFor(() => expect(server.sockets).toHaveLength(2))
    await vi.waitFor(() => expect(client.getStatus()).toBe('live'))
    expect(server.last().connected).toBe(true)
  })

  it('reports the rooms the gateway refused', async () => {
    const server = await startServer({ deny: ['wc:x'] })
    const onRoomsDenied = vi.fn()
    const { client } = setup(server, { onRoomsDenied })
    await live(client)
    client.subscribe(['job_order', 'wc:x'])
    await vi.waitFor(() => expect(onRoomsDenied).toHaveBeenCalledWith(['wc:x']))
    expect(onRoomsDenied).toHaveBeenCalledTimes(1)
  })

  it('sends the current token on every handshake', async () => {
    const server = await startServer()
    let token = 'first'
    const { client } = setup(server, { getToken: () => token })
    await live(client)
    token = 'second'
    server.last().disconnect(true)
    await vi.waitFor(() => expect(server.handshakes).toEqual(['first', 'second']))
  })

  it('ignores an event with no mapping', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server)
    const usersKey = ['get', '/users', {}]
    const users = observe(queryClient, usersKey)
    const jobOrders = observe(queryClient, ['get', '/job-orders', {}])
    await loaded(users, jobOrders)
    const received: Array<Record<string, unknown>> = []
    client.on('audit.created', payload => received.push(payload))
    await live(client)
    server.io.emit('audit.created', { userId: 'u1' })
    server.io.emit('job_order.started', { jobOrderId: 'j1' })
    await vi.waitFor(() => expect(jobOrders.calls).toBe(2))
    expect(received).toEqual([{ userId: 'u1' }])
    expect(users.calls).toBe(1)
    expect(queryClient.getQueryState(usersKey)?.isInvalidated).toBe(false)
  })

  it('never aborts a running refetch and refetches once more after it', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server, { throttleMs: 50 })
    const signals: AbortSignal[] = []
    const release: Array<() => void> = []
    cleanups.push(() => {
      for (const resolve of release) resolve()
    })
    const observer = new QueryObserver(queryClient, {
      queryKey: ['get', '/users', {}],
      queryFn: async ({ signal }) => {
        signals.push(signal)
        if (signals.length === 2) await new Promise<void>(resolve => release.push(resolve))
        return signals.length
      },
    })
    cleanups.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(1))
    await live(client)
    server.io.emit('user.updated', { userId: 'u1' })
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    for (let i = 0; i < 5; i++) {
      server.io.emit('user.updated', { userId: 'u1' })
      await sleep(40)
    }
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
    release[0]?.()
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(3))
    await sleep(150)
    expect(signals).toHaveLength(3)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('keeps a slow query fresh while events keep arriving', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server, { throttleMs: 50 })
    const key = ['get', '/users', {}]
    let version = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: async () => {
        const seen = version
        await sleep(150)
        return seen
      },
    })
    cleanups.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    await live(client)
    const updatesBefore = queryClient.getQueryState(key)?.dataUpdateCount ?? 0
    for (let i = 0; i < 20; i++) {
      version++
      server.io.emit('user.updated', { userId: 'u1' })
      await sleep(30)
    }
    const updatesDuring = (queryClient.getQueryState(key)?.dataUpdateCount ?? 0) - updatesBefore
    expect(updatesDuring).toBeGreaterThanOrEqual(2)
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(20), { timeout: 2000 })
  })

  it('refetches what is on screen when the first connect follows a refusal', async () => {
    const server = await startServer({
      reject: attempt => (attempt === 1 ? 'auth.unavailable' : undefined),
    })
    const { client, queryClient } = setup(server)
    const users = observe(queryClient, ['get', '/users', {}])
    const optedOut = observe(queryClient, ['get', '/work-centers', {}], { realtime: false })
    await loaded(users, optedOut)
    await live(client)
    await vi.waitFor(() => {
      expect(users.calls).toBe(2)
      expect(optedOut.calls).toBe(2)
    })
  })

  it('fetches nothing more on a clean first connect', async () => {
    const server = await startServer()
    const { client, queryClient } = setup(server)
    const users = observe(queryClient, ['get', '/users', {}])
    await loaded(users)
    await live(client)
    await vi.waitFor(() => expect(server.joins).toHaveLength(1))
    await sleep(100)
    expect(users.calls).toBe(1)
  })

  it('refetches after the gateway has acknowledged the rejoin', async () => {
    const log: string[] = []
    const server = await startServer({ ackDelayMs: 100, log })
    const { client, queryClient } = setup(server)
    const observer = new QueryObserver(queryClient, {
      queryKey: ['get', '/users', {}],
      queryFn: async () => {
        log.push('fetch')
        return log.length
      },
    })
    cleanups.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(log).toEqual(['fetch']))
    client.subscribe(['wc:a'])
    await live(client)
    await vi.waitFor(() => expect(log).toEqual(['fetch', 'ack']))
    server.last().conn.close()
    await vi.waitFor(() => expect(log).toHaveLength(4), { timeout: 5000 })
    expect(log).toEqual(['fetch', 'ack', 'ack', 'fetch'])
  })
})
