import { once } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { configureAuth, INTERNAL_TOKEN_HEADER } from '@mes/auth'
import jwt from 'jsonwebtoken'
import type { Server } from 'socket.io'
import { type Socket as ClientSocket, io as connect } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initSocketServer } from './socket.js'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const JWT_SECRET = 'socket-auth-test-secret'
const INTERNAL_API_TOKEN = 'test-internal-api-token-at-least-32-chars'
const VISIBLE_WC = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const HIDDEN_WC = 'bbbbbbbbbbbbbbbbbbbbbbbb'

const authContexts: Record<string, object> = {
  operator: {
    isActivated: true,
    passwordChangedAt: null,
    roles: [],
    permissions: [],
    workCenterIds: [VISIBLE_WC],
  },
  deactivated: {
    isActivated: false,
    passwordChangedAt: null,
    roles: [],
    permissions: [],
    workCenterIds: [VISIBLE_WC],
  },
}
const internalTokensSeen: unknown[] = []

// Stand-in for user-service's GET /internal/v1/users/:id/auth-context.
const userService = http.createServer((req, res) => {
  internalTokensSeen.push(req.headers[INTERNAL_TOKEN_HEADER])
  const userId = /^\/internal\/v1\/users\/([^/]+)\/auth-context$/.exec(req.url ?? '')?.[1]
  const ctx = userId ? authContexts[userId] : undefined
  res.writeHead(ctx ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(ctx ? { data: ctx } : { error: { code: 'user.not_found' } }))
})

let io: Server
let gatewayUrl: string
const clients: ClientSocket[] = []

const urlOf = (server: http.Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`

beforeAll(async () => {
  userService.listen(0, '127.0.0.1')
  await once(userService, 'listening')
  configureAuth({
    jwtSecret: JWT_SECRET,
    userServiceInternalUrl: urlOf(userService),
    internalApiToken: INTERNAL_API_TOKEN,
    cacheWrapDedup: (_key, _ttl, fetcher) => fetcher(),
  })

  const gateway = http.createServer()
  io = initSocketServer(gateway)
  gateway.listen(0, '127.0.0.1')
  await once(gateway, 'listening')
  gatewayUrl = urlOf(gateway)
})

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
  internalTokensSeen.length = 0
})

afterAll(() => {
  io.close()
  userService.close()
})

const tokenFor = (userId: string, secret = JWT_SECRET) => jwt.sign({ id: userId }, secret)

const connectWith = (auth: Record<string, unknown>): Promise<ClientSocket> => {
  const client = connect(gatewayUrl, {
    transports: ['websocket'],
    auth,
    reconnection: false,
    forceNew: true,
  })
  clients.push(client)
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client))
    client.once('connect_error', reject)
  })
}

describe('socket authentication', () => {
  it('rejects a connection without a token', async () => {
    await expect(connectWith({})).rejects.toThrow('auth.unauthenticated')
  })

  it('rejects a token signed with another secret', async () => {
    await expect(connectWith({ token: tokenFor('operator', 'not-the-secret') })).rejects.toThrow(
      'auth.unauthenticated',
    )
  })

  it('rejects a deactivated user', async () => {
    await expect(connectWith({ token: tokenFor('deactivated') })).rejects.toThrow(
      'auth.unauthenticated',
    )
  })

  it('accepts a valid token and asks user-service with the internal token', async () => {
    await connectWith({ token: tokenFor('operator') })
    expect(internalTokensSeen).toEqual([INTERNAL_API_TOKEN])
  })
})

describe('room authorization', () => {
  it('joins visible work center rooms and global rooms, skipping the rest', async () => {
    const client = await connectWith({ token: tokenFor('operator') })

    const ack = await client.emitWithAck('join', {
      rooms: [`wc:${VISIBLE_WC}`, `wc:${HIDDEN_WC}`, 'job_order', 42],
    })

    expect(ack).toEqual({ rooms: [`wc:${VISIBLE_WC}`, 'job_order'] })
  })

  it('does not deliver events of a work center the user cannot see', async () => {
    const client = await connectWith({ token: tokenFor('operator') })
    const received: string[] = []
    client.on('job_order.started', (payload: { workCenterId: string }) => {
      received.push(payload.workCenterId)
    })

    await client.emitWithAck('join', { rooms: [`wc:${VISIBLE_WC}`, `wc:${HIDDEN_WC}`] })
    io.to(`wc:${HIDDEN_WC}`).emit('job_order.started', { workCenterId: HIDDEN_WC })
    io.to(`wc:${VISIBLE_WC}`).emit('job_order.started', { workCenterId: VISIBLE_WC })

    // Both emits use the same connection, so a leaked hidden event would arrive first.
    await vi.waitFor(() => expect(received).toContain(VISIBLE_WC))
    expect(received).toEqual([VISIBLE_WC])
  })
})
