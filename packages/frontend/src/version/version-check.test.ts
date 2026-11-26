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
  server.closeAllConnections()
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

  it('reports again on the next check when the callback threw', async () => {
    serveVersion('1.1.0')
    const onMismatch = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('consumer failed')
      })
      .mockImplementation(() => undefined)
    const check = start(onMismatch)
    await expect(check.checkNow()).rejects.toThrow('consumer failed')
    await check.checkNow()
    expect(onMismatch).toHaveBeenCalledTimes(2)
    await check.checkNow()
    expect(onMismatch).toHaveBeenCalledTimes(2)
  })

  it('reports nothing that answers after stop, and checkNow does nothing after stop', async () => {
    let held: ServerResponse | undefined
    let requests = 0
    respond = res => {
      requests++
      held = res
    }
    const onMismatch = vi.fn()
    const check = start(onMismatch)
    const pending = check.checkNow()
    await vi.waitFor(() => expect(held).toBeDefined())
    check.stop()
    held?.setHeader('content-type', 'application/json')
    held?.end(JSON.stringify({ version: '1.1.0' }))
    await pending
    await check.checkNow()
    expect(onMismatch).not.toHaveBeenCalled()
    expect(requests).toBe(1)
  })

  // scenario: /version.json answers 1.1.0, currentVersion 1.0.0, one check → onMismatch('1.1.0')
  it('reports a newer server version after one check', async () => {
    const onMismatch = vi.fn()
    serveVersion('1.1.0')
    await start(onMismatch).checkNow()
    expect(onMismatch).toHaveBeenCalledTimes(1)
    expect(onMismatch).toHaveBeenCalledWith('1.1.0')
  })

  // scenario: a later check sees 1.2.0 → onMismatch is called once more, with '1.2.0'
  it('reports once more when a later check sees another version', async () => {
    const onMismatch = vi.fn()
    serveVersion('1.1.0')
    const check = start(onMismatch)
    await check.checkNow()
    expect(onMismatch).toHaveBeenCalledTimes(1)
    serveVersion('1.2.0')
    await check.checkNow()
    expect(onMismatch).toHaveBeenCalledTimes(2)
    expect(onMismatch).toHaveBeenLastCalledWith('1.2.0')
  })

  // scenario: no intervalMs given → url is polled every 300000 ms
  it('polls every 300000 ms when no interval is given', async () => {
    let requests = 0
    respond = res => {
      requests++
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ version: '1.0.0' }))
    }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const check = startVersionCheck({ currentVersion: '1.0.0', url, onMismatch: vi.fn() })
      stops.push(check.stop)
      vi.advanceTimersByTime(299_999)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(requests).toBe(0)
      vi.advanceTimersByTime(1)
      await vi.waitFor(() => expect(requests).toBe(1))
      vi.advanceTimersByTime(300_000)
      await vi.waitFor(() => expect(requests).toBe(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start a second request while one is in flight', async () => {
    let held: ServerResponse | undefined
    let requests = 0
    respond = res => {
      requests++
      held = res
    }
    const onMismatch = vi.fn()
    const check = start(onMismatch)
    const first = check.checkNow()
    const second = check.checkNow()
    await vi.waitFor(() => expect(held).toBeDefined())
    held?.setHeader('content-type', 'application/json')
    held?.end(JSON.stringify({ version: '1.1.0' }))
    await Promise.all([first, second])
    expect(requests).toBe(1)
    expect(onMismatch).toHaveBeenCalledTimes(1)
  })
})
