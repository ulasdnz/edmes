import { once } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { CustomError } from '@mes/core'
import jwt from 'jsonwebtoken'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resolveAuthUser } from './authenticate.js'
import { configureAuth } from './config.js'
import { AuthError } from './error.js'

const JWT_SECRET = 'authenticate-test-secret'
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const TIMEOUT_MS = 200

type UserServiceReply = 'ok' | 'not_found' | 'error' | 'hang' | 'drop'
let reply: UserServiceReply = 'ok'

const authContext = {
  isActivated: true,
  passwordChangedAt: null,
  roles: ['role-1'],
  permissions: ['readTags'],
  workCenterIds: ['wc-1'],
}

// Stand-in for user-service's GET /internal/v1/users/:id/auth-context.
const userService = http.createServer((req, res) => {
  if (reply === 'hang') return
  if (reply === 'drop') {
    req.socket.destroy()
    return
  }
  const status = { ok: 200, not_found: 404, error: 500 }[reply]
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(status === 200 ? { data: authContext } : { error: { code: 'x' } }))
})

beforeAll(async () => {
  userService.listen(0, '127.0.0.1')
  await once(userService, 'listening')
  configureAuth({
    jwtSecret: JWT_SECRET,
    userServiceInternalUrl: `http://127.0.0.1:${(userService.address() as AddressInfo).port}`,
    internalApiToken: 'test-internal-api-token-at-least-32-chars',
    userServiceTimeoutMs: TIMEOUT_MS,
    cacheWrapDedup: (_key, _ttl, fetcher) => fetcher(),
  })
})

afterEach(() => {
  reply = 'ok'
})

afterAll(() => {
  userService.closeAllConnections()
  userService.close()
})

const token = () => jwt.sign({ id: USER_ID }, JWT_SECRET)

// A user-service outage says nothing about the token, so it must not look like a logout.
const expectUnavailable = async (attempt: Promise<unknown>) => {
  const error = await attempt.catch(e => e)
  expect(error).toBeInstanceOf(CustomError)
  expect(error).not.toBeInstanceOf(AuthError)
  expect(error).toMatchObject({ statusCode: 503, message: 'auth.unavailable' })
}

describe('resolveAuthUser', () => {
  it('resolves the user from the auth context', async () => {
    await expect(resolveAuthUser(token())).resolves.toEqual({
      id: USER_ID,
      roles: ['role-1'],
      permissions: ['readTags'],
      workCenterIds: ['wc-1'],
    })
  })

  it('rejects the token when the user no longer exists', async () => {
    reply = 'not_found'
    const error = await resolveAuthUser(token()).catch(e => e)
    expect(error).toBeInstanceOf(AuthError)
    expect(error).toMatchObject({ statusCode: 401, message: 'auth.unauthenticated' })
  })

  it('reports a user-service error as unavailable', async () => {
    reply = 'error'
    await expectUnavailable(resolveAuthUser(token()))
  })

  it('reports an unreachable user-service as unavailable', async () => {
    reply = 'drop'
    await expectUnavailable(resolveAuthUser(token()))
  })

  it('gives up when user-service does not answer in time', async () => {
    reply = 'hang'
    const startedAt = Date.now()
    await expectUnavailable(resolveAuthUser(token()))
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUT_MS + 1000)
  })
})
