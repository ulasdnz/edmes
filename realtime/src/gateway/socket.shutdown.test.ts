import { once } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { configureAuth } from '@mes/auth'
import jwt from 'jsonwebtoken'
import { io as connect } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeSocketServer, initSocketServer } from './socket.js'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const JWT_SECRET = 'socket-shutdown-test-secret'

// Stand-in for user-service's GET /internal/v1/users/:id/auth-context.
const userService = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      data: {
        isActivated: true,
        passwordChangedAt: null,
        roles: [],
        permissions: [],
        workCenterIds: [],
      },
    }),
  )
})

const urlOf = (server: http.Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`

beforeAll(async () => {
  userService.listen(0, '127.0.0.1')
  await once(userService, 'listening')
  configureAuth({
    jwtSecret: JWT_SECRET,
    userServiceInternalUrl: urlOf(userService),
    internalApiToken: 'test-internal-api-token-at-least-32-chars',
    cacheWrapDedup: (_key, _ttl, fetcher) => fetcher(),
  })
})

afterAll(() => {
  userService.close()
})

describe('closeSocketServer', () => {
  it('closes the HTTP server while clients are still connected', async () => {
    const gateway = http.createServer()
    initSocketServer(gateway)
    gateway.listen(0, '127.0.0.1')
    await once(gateway, 'listening')

    const client = connect(urlOf(gateway), {
      transports: ['websocket'],
      auth: { token: jwt.sign({ id: 'operator' }, JWT_SECRET) },
      reconnection: false,
      forceNew: true,
    })
    await new Promise(resolve => client.once('connect', () => resolve(undefined)))
    const disconnected = new Promise(resolve => client.once('disconnect', resolve))

    await closeSocketServer()

    expect(gateway.listening).toBe(false)
    await expect(disconnected).resolves.toBeDefined()
  })
})
