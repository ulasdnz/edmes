import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type AppCore, createAppCore } from '@mes/frontend/core'
import { Server } from 'socket.io'

export type Reply = (res: ServerResponse) => void

export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export const errorReply =
  (status: number, code: string): Reply =>
  res =>
    json(res, status, { error: { code, message: code } })

// What the frontend's nginx answers under /api while the service behind the path is stopped: the
// gateway has dropped its router, so the catch-all reaches nginx (apps/nginx.conf).
export const gatewayUnavailable: Reply = res => {
  res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end('{"error":{"code":"gateway.unavailable","message":"Service unavailable"}}')
}

export const USER_ID = '0123456789abcdef01234567'

export const me: Reply = res =>
  json(res, 200, {
    data: {
      _id: USER_ID,
      username: 'ada',
      email: 'ada@example.com',
      name: 'Ada',
      surname: 'Lovelace',
      roles: ['r1'],
      language: 'en',
      workCenterIds: [],
      specialities: [],
      props: {},
      isActivated: true,
      isActiveDirectoryUser: false,
      mustChangePassword: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    meta: {
      plantTimezone: 'Europe/Istanbul',
      serverTime: '2026-11-25T10:00:00.000Z',
      permissions: ['accessOperatorPanel', 'readWorkCenters', 'readJobOrders'],
    },
  })

const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, limit: 100, total: data.length, totalPages: 1 },
})

export const workCenters =
  (...ids: string[]): Reply =>
  res =>
    json(
      res,
      200,
      page(
        ids.map(id => ({
          _id: id,
          code: id.toUpperCase(),
          name: `Work center ${id}`,
          description: null,
          type: 'physical',
          status: 'active',
          parentWorkCenterId: null,
          props: {},
          shiftIds: [],
          productivityMode: null,
          tagBindings: null,
          metricComposition: null,
        })),
      ),
    )

export const noJobOrder: Reply = res => json(res, 200, page([]))

// One node:http server answers the REST calls by "METHOD path" from a script per route, and
// carries a socket.io server on /socket.io the way the gateway sits behind the same origin.
export async function startBackend(
  routes: Record<string, Reply[]>,
  cleanups: Array<() => unknown>,
) {
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
      const rooms = Array.isArray(data?.rooms) ? data.rooms : []
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
  return { url, emit, members, count }
}

export function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

export function buildCore(url: string, storage: Storage, cleanups: Array<() => unknown>): AppCore {
  const core = createAppCore({
    app: 'operator',
    storage,
    getLocale: () => 'en',
    apiBaseUrl: url,
    realtimeUrl: url,
  })
  cleanups.push(() => core.session.logout())
  return core
}
