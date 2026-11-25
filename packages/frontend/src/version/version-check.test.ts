import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startVersionCheck } from './version-check'

let server: Server
let url: string
let respond: (res: ServerResponse) => void
const stops: Array<() => void> = []

beforeEach(async () => {
  server = createServer((_req, res) => respond(res))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/version.json`
})

afterEach(async () => {
  for (const stop of stops.splice(0)) stop()
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
})

function serveVersion(version: string) {
  respond = res => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ version }))
  }
}

function start(onMismatch: (version: string) => void, intervalMs = 3_600_000) {
  const check = startVersionCheck({ currentVersion: '1.0.0', url, intervalMs, onMismatch })
  stops.push(check.stop)
  return check
}

describe('startVersionCheck', () => {
  it('reports a different server version once', async () => {
    const onMismatch = vi.fn()
    serveVersion('1.1.0')
    const check = start(onMismatch)
    await check.checkNow()
    await check.checkNow()
    await check.checkNow()
    expect(onMismatch).toHaveBeenCalledTimes(1)
    expect(onMismatch).toHaveBeenCalledWith('1.1.0')

    serveVersion('1.2.0')
    await check.checkNow()
    await check.checkNow()
    expect(onMismatch).toHaveBeenCalledTimes(2)
    expect(onMismatch).toHaveBeenLastCalledWith('1.2.0')
  })

  it('stays silent when the version matches', async () => {
    const onMismatch = vi.fn()
    serveVersion('1.0.0')
    await start(onMismatch).checkNow()
    expect(onMismatch).not.toHaveBeenCalled()
  })

  it('stays silent when the server answers with HTML', async () => {
    const onMismatch = vi.fn()
    respond = res => {
      res.statusCode = 502
      res.setHeader('content-type', 'text/html')
      res.end('<html>Bad Gateway</html>')
    }
    await start(onMismatch).checkNow()
    expect(onMismatch).not.toHaveBeenCalled()
  })

  it('stays silent when the server is down', async () => {
    const onMismatch = vi.fn()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await start(onMismatch).checkNow()
    expect(onMismatch).not.toHaveBeenCalled()
  })

  it('checks again on the interval until stopped', async () => {
    const onMismatch = vi.fn()
    serveVersion('1.1.0')
    start(onMismatch, 50)
    await vi.waitFor(() => expect(onMismatch).toHaveBeenCalledTimes(1))
  })

  it('does not check after stop', async () => {
    let requests = 0
    respond = res => {
      requests++
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ version: '1.0.0' }))
    }
    const check = start(vi.fn(), 20)
    await vi.waitFor(() => expect(requests).toBeGreaterThan(0))
    check.stop()
    await new Promise(resolve => setTimeout(resolve, 50))
    const seen = requests
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(requests).toBe(seen)
  })
})
