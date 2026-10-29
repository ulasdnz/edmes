import { once } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { configureAuth, INTERNAL_TOKEN_HEADER } from '@mes/auth'
import jwt from 'jsonwebtoken'
import type { Server } from 'socket.io'
import { type Socket as ClientSocket, io as connect } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { emitToRooms, initSocketServer, recheckConnections } from './socket.js'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const JWT_SECRET = 'socket-auth-test-secret'
const INTERNAL_API_TOKEN = 'test-internal-api-token-at-least-32-chars'
const VISIBLE_WC = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const HIDDEN_WC = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const TAG = 'cccccccccccccccccccccccc'

interface AuthContextFixture {
  isActivated: boolean
  passwordChangedAt: string | null
  roles: string[]
  permissions: string[]
  workCenterIds: string[]
}

const activeUser = (overrides: Partial<AuthContextFixture> = {}): AuthContextFixture => ({
  isActivated: true,
  passwordChangedAt: null,
  roles: [],
  permissions: [],
  workCenterIds: [VISIBLE_WC],
  ...overrides,
})

const authContexts: Record<string, AuthContextFixture> = {
  operator: activeUser(),
  historian: activeUser({ permissions: ['readHistorian'] }),
  deactivated: activeUser({ isActivated: false }),
}
const internalTokensSeen: unknown[] = []
let userServiceDown = false

// Stand-in for user-service's GET /internal/v1/users/:id/auth-context.
const userService = http.createServer((req, res) => {
  if (userServiceDown) {
    req.socket.destroy()
    return
  }
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

const collect = (client: ClientSocket, event: string): unknown[] => {
  const received: unknown[] = []
  client.on(event, payload => received.push(payload))
  return received
}

const disconnectReason = (client: ClientSocket): Promise<string> =>
  new Promise(resolve => client.once('disconnect', reason => resolve(reason)))

// Events on one connection arrive in order, so once this marker arrives,
// anything emitted before it would already have arrived too.
const MARKER_ROOM = 'role'
const emitMarker = () => emitToRooms([MARKER_ROOM], 'role.updated', { roleId: 'marker' })

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

describe('event delivery', () => {
  it('does not deliver a work center event to an entity room subscriber who cannot see it', async () => {
    const client = await connectWith({ token: tokenFor('operator') })
    const received = collect(client, 'job_order.started')
    await client.emitWithAck('join', { rooms: ['job_order'] })

    const hidden = { jobOrderId: 'hidden', workCenterId: HIDDEN_WC }
    const visible = { jobOrderId: 'visible', workCenterId: VISIBLE_WC }
    await emitToRooms(['job_order', `wc:${HIDDEN_WC}`], 'job_order.started', hidden)
    await emitToRooms(['job_order', `wc:${VISIBLE_WC}`], 'job_order.started', visible)

    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received).toEqual([visible])
  })

  it('delivers a move to the user who can only see the previous work center', async () => {
    const client = await connectWith({ token: tokenFor('operator') })
    const received = collect(client, 'job_order.updated')
    await client.emitWithAck('join', { rooms: ['job_order'] })

    const moved = { jobOrderId: 'moved', workCenterId: HIDDEN_WC, previousWorkCenterId: VISIBLE_WC }
    await emitToRooms(
      ['job_order', `wc:${HIDDEN_WC}`, `wc:${VISIBLE_WC}`],
      'job_order.updated',
      moved,
    )

    await vi.waitFor(() => expect(received).toEqual([moved]))
  })

  it('delivers events without a work center to every subscriber of the room', async () => {
    const client = await connectWith({ token: tokenFor('operator') })
    const received = collect(client, 'role.updated')
    await client.emitWithAck('join', { rooms: ['role'] })

    await emitToRooms(['role'], 'role.updated', { roleId: 'r1' })

    await vi.waitFor(() => expect(received).toEqual([{ roleId: 'r1' }]))
  })

  it('delivers tag values only to users who may read the historian', async () => {
    const operator = await connectWith({ token: tokenFor('operator') })
    const historian = await connectWith({ token: tokenFor('historian') })
    const operatorValues = collect(operator, 'tag.value.recorded')
    const operatorMarkers = collect(operator, 'role.updated')
    const historianValues = collect(historian, 'tag.value.recorded')
    for (const client of [operator, historian]) {
      await client.emitWithAck('join', { rooms: [`tag:${TAG}`, MARKER_ROOM] })
    }

    const sample = {
      tagId: TAG,
      behavior: 'counter',
      value: 42,
      occurredAt: '2026-10-28T08:00:00.000Z',
    }
    await emitToRooms(['tag', `tag:${TAG}`], 'tag.value.recorded', sample)
    await emitMarker()

    await vi.waitFor(() => expect(operatorMarkers).toHaveLength(1))
    expect(operatorValues).toEqual([])
    await vi.waitFor(() => expect(historianValues).toEqual([sample]))
  })
})

describe('connection recheck', () => {
  it('disconnects a user who was deactivated while connected', async () => {
    authContexts.revoked = activeUser()
    const client = await connectWith({ token: tokenFor('revoked') })
    const disconnected = disconnectReason(client)

    authContexts.revoked.isActivated = false
    await recheckConnections()

    await expect(disconnected).resolves.toBe('io server disconnect')
  })

  it('stops delivering a work center the user lost while connected', async () => {
    authContexts.reassigned = activeUser()
    const client = await connectWith({ token: tokenFor('reassigned') })
    const received = collect(client, 'job_order.started')
    const markers = collect(client, 'role.updated')
    await client.emitWithAck('join', { rooms: [`wc:${VISIBLE_WC}`, MARKER_ROOM] })

    authContexts.reassigned.workCenterIds = []
    await recheckConnections()
    await emitToRooms([`wc:${VISIBLE_WC}`], 'job_order.started', {
      jobOrderId: 'j1',
      workCenterId: VISIBLE_WC,
    })
    await emitMarker()

    await vi.waitFor(() => expect(markers).toHaveLength(1))
    expect(received).toEqual([])
    expect(client.connected).toBe(true)
  })

  it('disconnects a socket whose token has expired', async () => {
    const token = jwt.sign({ id: 'operator' }, JWT_SECRET, { expiresIn: '1h' })
    const client = await connectWith({ token })
    const disconnected = disconnectReason(client)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000)
    try {
      await recheckConnections()
    } finally {
      vi.useRealTimers()
    }

    await expect(disconnected).resolves.toBe('io server disconnect')
  })

  it('keeps connections open when user-service cannot be reached', async () => {
    const client = await connectWith({ token: tokenFor('operator') })

    userServiceDown = true
    try {
      await recheckConnections()
    } finally {
      userServiceDown = false
    }

    const ack = await client.emitWithAck('join', { rooms: [MARKER_ROOM] })
    expect(ack).toEqual({ rooms: [MARKER_ROOM] })
    expect(client.connected).toBe(true)
  })
})
