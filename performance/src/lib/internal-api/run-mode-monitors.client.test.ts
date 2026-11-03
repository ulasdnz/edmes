import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import express, { type Response } from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../logger.js'
import { listRunModeMonitors } from './run-mode-monitors.client.js'

const { config } = vi.hoisted(() => ({
  config: {
    INTERNAL_API_WORK_CENTER: '',
    INTERNAL_API_TOKEN: 'test-internal-api-token-at-least-32-chars',
  },
}))

vi.mock('../../config/index.js', () => ({ config }))

vi.mock('@mes/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@mes/core')>()),
  getTraceId: () => 'trace-1',
}))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Work-center as a stub server: each test says how the monitors endpoint answers
let answer: (res: Response) => void
const received: { token: string | undefined }[] = []
let server: Server

beforeAll(async () => {
  const app = express()
  app.get('/internal/v1/work-centers/run-mode-monitors', (req, res) => {
    received.push({ token: req.header(INTERNAL_TOKEN_HEADER) })
    answer(res)
  })
  server = await new Promise<Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  config.INTERNAL_API_WORK_CENTER = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

beforeEach(() => {
  received.length = 0
  vi.mocked(logger.warn).mockClear()
  vi.mocked(logger.debug).mockClear()
})

describe('listRunModeMonitors', () => {
  it('calls the run-mode-monitors internal endpoint and returns parsed data', async () => {
    const data = [
      { workCenterId: 'wc-1', runModeTagId: 'tag-1' },
      { workCenterId: 'wc-2', runModeTagId: 'tag-2' },
    ]
    answer = res => res.json({ data })

    expect(await listRunModeMonitors()).toEqual(data)
    expect(received).toEqual([{ token: config.INTERNAL_API_TOKEN }])
  })

  it('returns no monitors when work-center lists none', async () => {
    answer = res => res.json({ data: [] })

    expect(await listRunModeMonitors()).toEqual([])
  })

  it.each([
    ['{}', {}],
    ['{ data: null }', { data: null }],
  ])('fails with 503 when work-center answers %s, never "no monitors"', async (_, body) => {
    answer = res => res.json(body)

    await expect(listRunModeMonitors()).rejects.toMatchObject({
      statusCode: 503,
      message: 'error.work_center_unreachable',
      cause: 'invalid body',
    })
  })

  it('fails with 503 when work-center answers with an error', async () => {
    answer = res => res.status(500).json({ error: { code: 'error.internal', message: 'x' } })

    await expect(listRunModeMonitors()).rejects.toMatchObject({
      statusCode: 503,
      message: 'error.work_center_unreachable',
      cause: 'HTTP 500',
    })
    expect(logger.warn).toHaveBeenCalledWith('Run-mode monitors fetch failed', {
      event: 'internal_api.run_mode_monitors.fetch_failed',
      status: 500,
    })
  })

  it('fails with 503 when work-center cannot be reached', async () => {
    const reachable = config.INTERNAL_API_WORK_CENTER
    // A port nothing listens on: the connection is refused
    const closed = express().listen(0, '127.0.0.1')
    await new Promise(resolve => closed.once('listening', resolve))
    const { port } = closed.address() as AddressInfo
    await new Promise(resolve => closed.close(resolve))
    config.INTERNAL_API_WORK_CENTER = `http://127.0.0.1:${port}`
    try {
      await expect(listRunModeMonitors()).rejects.toMatchObject({
        statusCode: 503,
        message: 'error.work_center_unreachable',
        cause: expect.stringContaining('ECONNREFUSED'),
      })
    } finally {
      config.INTERNAL_API_WORK_CENTER = reachable
    }
    expect(logger.warn).toHaveBeenCalledWith(
      'Run-mode monitors fetch errored',
      expect.objectContaining({ event: 'internal_api.run_mode_monitors.fetch_errored' }),
    )
  })

  it('logs its failure at debug for a caller that logs it itself', async () => {
    answer = res => res.status(503).end()

    await expect(listRunModeMonitors({ failureLogLevel: 'debug' })).rejects.toMatchObject({
      statusCode: 503,
      cause: 'HTTP 503',
    })
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith('Run-mode monitors fetch failed', {
      event: 'internal_api.run_mode_monitors.fetch_failed',
      status: 503,
    })
  })

  it('stops waiting for work-center once its caller aborts', async () => {
    let hold: Response | undefined
    answer = res => {
      hold = res
    }
    const controller = new AbortController()

    const listing = listRunModeMonitors({ failureLogLevel: 'debug', signal: controller.signal })
    await vi.waitFor(() => expect(hold).toBeDefined())
    controller.abort()

    await expect(listing).rejects.toMatchObject({
      statusCode: 503,
      message: 'error.work_center_unreachable',
    })
    hold?.destroy()
  })
})
