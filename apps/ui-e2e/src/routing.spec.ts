import { spawnSync } from 'node:child_process'
import { type APIResponse, expect, test } from '@playwright/test'
import { repositoryRoot } from './compose'

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

function cspHeaders(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter(header => header.name.toLowerCase() === 'content-security-policy')
    .map(header => header.value)
}

// Asks nginx inside the frontend container directly, past the gateway's routing
function askNginx(path: string): string {
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'frontend', 'wget', '-S', '-O', '-', `http://127.0.0.1:8080${path}`],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
  return `${result.stdout}\n${result.stderr}`
}

test.describe('the gateway routes', () => {
  test('/ answers 200 with the web app', async ({ request }) => {
    const response = await request.get('/')
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('id="root"')
  })

  test('a web app path falls back to its index.html', async ({ request }) => {
    const response = await request.get('/users')
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html.match(/id="root"/g)).toHaveLength(1)
    expect(html).not.toContain('/operator/assets/')
  })

  test('/operator redirects to /operator/', async ({ request }) => {
    const response = await request.get('/operator', { maxRedirects: 0 })
    expect(response.status()).toBe(301)
    expect(new URL(response.headers().location ?? '', 'http://localhost/').href).toBe(
      'http://localhost/operator/',
    )
  })

  test('a panel path falls back to the panel index.html', async ({ request }) => {
    const response = await request.get('/operator/select-work-center')
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('/operator/assets/')
  })

  test('/version.json names the version and is never cached', async ({ request }) => {
    const response = await request.get('/version.json')
    expect(await response.json()).toEqual({ version: 'dev' })
    expect(response.headers()['cache-control']).toBe('no-cache')
  })

  test('/index.html is never cached', async ({ request }) => {
    const response = await request.get('/index.html')
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-cache')
  })

  test('/healthz answers 200', async ({ request }) => {
    expect((await request.get('/healthz')).status()).toBe(200)
  })

  test('an API path without a token reaches its service, not the frontend', async ({ request }) => {
    const response = await request.get('/api/v1/users/me')
    expect(response.status()).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'auth.unauthenticated' } })
  })

  test('an API path no service serves is a 404, never the app', async ({ request }) => {
    const response = await request.get('/api/v1/no-such-thing')
    expect(response.status()).toBe(404)
    expect(await response.text()).not.toContain('id="root"')
  })

  test('/internal is not reachable through the gateway', async ({ request }) => {
    const response = await request.get('/internal/v1/users')
    expect(response.status()).toBe(404)
    expect(await response.text()).not.toContain('id="root"')
  })

  test('/uploads is answered by user-service', async ({ request }) => {
    const response = await request.get('/uploads/no-such-file.png')
    expect(response.status()).toBe(404)
    // Express answers it and every service response carries a trace id; nginx sets none
    expect(response.headers()['x-trace-id']).toBeTruthy()
    expect(await response.text()).toContain('Cannot GET /uploads/no-such-file.png')
  })

  test('nginx itself answers 404 under the API prefixes, never index.html', () => {
    for (const path of ['/api/x', '/internal/x', '/socket.io/x', '/docs', '/uploads/x.png']) {
      const output = askNginx(path)
      expect(output, path).toContain('HTTP/1.1 404')
      expect(output, path).not.toContain('id="root"')
    }
  })
})

test.describe('the security headers', () => {
  test('/ carries exactly one Content-Security-Policy, with the agreed value', async ({
    request,
  }) => {
    expect(cspHeaders(await request.get('/'))).toEqual([CSP])
  })

  test('/version.json, with its own add_header, still carries one', async ({ request }) => {
    expect(cspHeaders(await request.get('/version.json'))).toEqual([CSP])
  })

  test('built files are cached for good and still carry the policy', async ({ request }) => {
    for (const page of ['/', '/operator/']) {
      const html = await (await request.get(page)).text()
      const asset = html.match(/(?:\/operator)?\/assets\/[^"]+\.js/)?.[0]
      expect(asset, page).toBeTruthy()
      const response = await request.get(asset ?? '')
      expect(response.status()).toBe(200)
      expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
      expect(cspHeaders(response)).toEqual([CSP])
    }
  })
})
