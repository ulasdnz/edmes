import { inject } from 'vitest'
import type { ServiceName } from '../global-setup.js'

export class Api {
  constructor(private readonly headers: Record<string, string> = {}) {}

  static internal() {
    return new Api({ 'x-internal-token': inject('internalToken') })
  }

  async request<T>(service: ServiceName, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${inject('urls')[service]}${path}`, {
      method,
      headers: {
        ...this.headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => null)) as { data?: T; error?: unknown } | null
    if (!res.ok) {
      const detail = JSON.stringify(payload?.error ?? payload)
      throw new Error(`${method} ${service} ${path} answered ${res.status}: ${detail}`)
    }
    return payload?.data as T
  }

  get<T>(service: ServiceName, path: string) {
    return this.request<T>(service, 'GET', path)
  }

  post<T>(service: ServiceName, path: string, body: unknown) {
    return this.request<T>(service, 'POST', path, body)
  }

  patch<T>(service: ServiceName, path: string, body: unknown) {
    return this.request<T>(service, 'PATCH', path, body)
  }
}

export async function loginAsAdmin() {
  const { email, password } = inject('admin')
  const session = await new Api().post<{ token: string; user: { _id: string } }>(
    'user',
    '/api/v1/auth/login',
    { email, password },
  )
  return { api: new Api({ authorization: `Bearer ${session.token}` }), userId: session.user._id }
}

// Polls until the value satisfies the check; for state another service builds asynchronously.
export async function eventually<T>(read: () => Promise<T>, check: (value: T) => boolean) {
  const deadline = Date.now() + 15_000
  let last: T
  do {
    last = await read()
    if (check(last)) return last
    await new Promise(r => setTimeout(r, 200))
  } while (Date.now() < deadline)
  throw new Error(`condition not met within 15s, last value: ${JSON.stringify(last)}`)
}
