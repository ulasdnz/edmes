import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ApiError, createApiClient } from '@mes/api-client'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { myProfileOptions, removeMyAvatar, updateMe, uploadMyAvatar } from './me'

interface Seen {
  method: string
  path: string
  contentType: string
  body: string
}

const user = {
  _id: '0123456789abcdef01234567',
  username: 'ayse.demir',
  email: 'ayse@example.com',
  name: 'Ayşe',
  surname: 'Demir',
  roles: [{ _id: 'r1', name: 'Planner', description: 'Plans, job orders and schedules.' }],
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

describe('my profile data', () => {
  let server: Server | undefined
  const seen: Seen[] = []

  afterEach(async () => {
    seen.length = 0
    await new Promise(resolve => server?.close(resolve))
  })

  async function serve(answer: (request: Seen) => { status?: number; body: unknown }) {
    server = createServer(async (req: IncomingMessage, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const url = new URL(req.url ?? '/', 'http://localhost')
      const request = {
        method: req.method ?? '',
        path: `${url.pathname}${url.search}`,
        contentType: req.headers['content-type'] ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
      }
      seen.push(request)
      const result = answer(request)
      res.statusCode = result.status ?? 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(result.body))
    })
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    return createApiClient({
      baseUrl: `http://127.0.0.1:${port}`,
      getToken: () => 'token',
      getLocale: () => 'en',
      onUnauthorized: () => {},
    })
  }

  it('reads /users/me with populate=roles and keeps the populated roles', async () => {
    const api = await serve(() => ({
      body: {
        data: user,
        meta: { plantTimezone: 'Europe/Istanbul', serverTime: '', permissions: [] },
      },
    }))
    const options = myProfileOptions(api)
    const answer = await new QueryClient().fetchQuery(options)

    expect(seen.map(request => `${request.method} ${request.path}`)).toEqual([
      'GET /users/me?populate=roles',
    ])
    expect(options.queryKey.slice(0, 2)).toEqual(['get', '/users/me'])
    expect(options.select?.(answer)).toEqual({ user, roles: user.roles })
  })

  it('sends only the fields it is given with PATCH /users/me', async () => {
    const api = await serve(() => ({
      body: { data: { ...user, surname: 'Yılmaz' }, message: 'ok' },
    }))

    const saved = await updateMe(api, { surname: 'Yılmaz' })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('PATCH')
    expect(seen[0]?.path).toBe('/users/me')
    expect(JSON.parse(seen[0]?.body ?? '')).toEqual({ surname: 'Yılmaz' })
    expect(saved.surname).toBe('Yılmaz')
  })

  it('uploads the photo as multipart form data under the field photo', async () => {
    const api = await serve(() => ({
      body: { data: { ...user, photoUrl: '/uploads/a.png' }, message: 'ok' },
    }))
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'face.png', {
      type: 'image/png',
    })

    const saved = await uploadMyAvatar(api, file)

    expect(seen[0]?.method).toBe('PATCH')
    expect(seen[0]?.path).toBe('/users/me/avatar')
    expect(seen[0]?.contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(seen[0]?.body).toContain('name="photo"; filename="face.png"')
    expect(saved.photoUrl).toBe('/uploads/a.png')
  })

  it('removes the photo with DELETE /users/me/avatar', async () => {
    const api = await serve(() => ({ body: { data: { ...user, photoUrl: null }, message: 'ok' } }))

    const saved = await removeMyAvatar(api)

    expect(seen.map(request => `${request.method} ${request.path}`)).toEqual([
      'DELETE /users/me/avatar',
    ])
    expect(saved.photoUrl).toBeNull()
  })

  it('throws the server error with its details', async () => {
    const api = await serve(() => ({
      status: 400,
      body: {
        error: {
          code: 'error.validation_failed',
          message: 'Validation failed.',
          details: [{ field: 'email', message: 'Invalid email format' }],
        },
      },
    }))

    const failure = await updateMe(api, { email: 'a@b' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).details).toEqual([
      { field: 'email', message: 'Invalid email format' },
    ])
  })
})
