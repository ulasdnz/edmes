import { QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryProblem } from '../recovery'
import {
  buildCore,
  errorReply,
  gatewayUnavailable,
  memoryStorage,
  noJobOrder,
  type Reply,
  startBackend,
  workCenters,
} from '../test/backend'
import { stationJobOrderQuery, visibleWorkCentersQuery } from './station-queries'

const cleanups: Array<() => unknown> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const RECOVERY_MS = 50
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const unavailable = errorReply(503, 'proxy.unavailable')
const badGateway = errorReply(502, 'proxy.bad_gateway')
const forbidden = errorReply(403, 'auth.forbidden')

type Shown = Parameters<typeof queryProblem>[0] & { status: string; data?: unknown }

interface Observed {
  subscribe(listener: (result: Shown) => void): () => void
  getCurrentResult(): Shown
  destroy(): void
}

async function observe(
  route: string,
  replies: Reply[],
  create: (core: ReturnType<typeof buildCore>) => Observed,
) {
  const backend = await startBackend({ [route]: replies }, cleanups)
  const core = buildCore(backend.url, memoryStorage(), cleanups)
  const observer = create(core)
  // what the screen shows, in order
  const seen: Array<ReturnType<typeof queryProblem>> = []
  const stop = observer.subscribe(result => {
    const shown = queryProblem(result)
    if (seen.at(-1) !== shown) seen.push(shown)
  })
  cleanups.push(stop)
  return { backend, observer, seen }
}

describe('station queries', () => {
  it('recover the work centers by themselves after the server answers 503', async () => {
    const route = 'GET /work-centers'
    const { backend, observer, seen } = await observe(
      route,
      [unavailable, unavailable, workCenters('wc1')],
      core => new QueryObserver(core.queryClient, visibleWorkCentersQuery(core.api, RECOVERY_MS)),
    )
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    expect(backend.count(route)).toBe(3)
    // unreachable until the answer: never back to loading in between
    expect(seen).toEqual(['loading', 'unavailable', null])
    await sleep(RECOVERY_MS * 4)
    expect(backend.count(route)).toBe(3)
  })

  it('recover the running job order by themselves after the server answers 502', async () => {
    const route = 'GET /job-orders'
    const { backend, observer, seen } = await observe(
      route,
      [badGateway, badGateway, noJobOrder],
      core =>
        new QueryObserver(core.queryClient, stationJobOrderQuery(core.api, 'wc1', RECOVERY_MS)),
    )
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    expect(observer.getCurrentResult().data).toBeNull()
    expect(backend.count(route)).toBe(3)
    expect(seen).toEqual(['loading', 'unavailable', null])
  })

  // A stopped service has no router at the gateway, so its paths reach the frontend's nginx
  it.each([
    [
      'GET /work-centers',
      workCenters('wc1'),
      (core: ReturnType<typeof buildCore>) =>
        new QueryObserver(core.queryClient, visibleWorkCentersQuery(core.api, RECOVERY_MS)),
    ],
    [
      'GET /job-orders',
      noJobOrder,
      (core: ReturnType<typeof buildCore>) =>
        new QueryObserver(core.queryClient, stationJobOrderQuery(core.api, 'wc1', RECOVERY_MS)),
    ],
  ])('recover %s by themselves while the gateway says the service is stopped', async (route, answer, create) => {
    const { backend, observer, seen } = await observe(
      route,
      [gatewayUnavailable, gatewayUnavailable, answer],
      create,
    )
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    expect(backend.count(route)).toBe(3)
    expect(seen).toEqual(['loading', 'unavailable', null])
  })

  it('do not ask again after a 403', async () => {
    const route = 'GET /work-centers'
    const { backend, observer, seen } = await observe(
      route,
      [forbidden, workCenters('wc1')],
      core => new QueryObserver(core.queryClient, visibleWorkCentersQuery(core.api, RECOVERY_MS)),
    )
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('error'))
    await sleep(RECOVERY_MS * 6)
    expect(backend.count(route)).toBe(1)
    expect(seen).toEqual(['loading', 'failed'])
  })

  it('stop asking when nothing observes them any more', async () => {
    const route = 'GET /work-centers'
    const { backend, observer } = await observe(
      route,
      [unavailable],
      core => new QueryObserver(core.queryClient, visibleWorkCentersQuery(core.api, RECOVERY_MS)),
    )
    await vi.waitFor(() => expect(backend.count(route)).toBe(1))
    expect(queryProblem(observer.getCurrentResult())).toBe('unavailable')
    observer.destroy()
    const asked = backend.count(route)
    await sleep(RECOVERY_MS * 6)
    expect(backend.count(route)).toBe(asked)
  })
})
