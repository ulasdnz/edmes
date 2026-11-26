import { workCentersListOptions } from '@mes/frontend/data/work-center/work-centers'
import { QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCore,
  errorReply,
  me,
  memoryStorage,
  type Reply,
  startBackend,
  USER_ID,
  workCenters,
} from '../test/backend'
import { followAssignments } from './follow-assignments'
import { visibleWorkCentersQuery } from './station-queries'
import { createStationStore } from './station-store'

const cleanups: Array<() => unknown> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function signedIn(listReplies: Reply[], station?: string) {
  const backend = await startBackend(
    { 'GET /users/me': [me], 'GET /work-centers': listReplies },
    cleanups,
  )
  const storage = memoryStorage({
    'edmes.operator.token': 'tkn',
    ...(station ? { 'edmes.operator.station': station } : {}),
  })
  const core = buildCore(backend.url, storage, cleanups)
  const store = createStationStore(storage)
  cleanups.push(followAssignments(core, store))
  await core.session.bootstrap()
  await vi.waitFor(() => expect(backend.members('user')).toBe(1))
  return { backend, core, store }
}

describe('followAssignments', () => {
  it("clears the station when the user's update takes it away", async () => {
    const { backend, store } = await signedIn([workCenters('wc2')], 'wc1')

    backend.emit('user.updated', { userId: 'someone-else' })
    await sleep(100)
    expect(backend.count('GET /work-centers')).toBe(0)
    expect(store.getWorkCenterId()).toBe('wc1')

    backend.emit('user.updated', { userId: USER_ID })
    await vi.waitFor(() => expect(store.getWorkCenterId()).toBeNull())
    expect(backend.count('GET /work-centers')).toBe(1)
  })

  it('keeps a station that is still assigned', async () => {
    const { backend, store } = await signedIn([workCenters('wc1', 'wc2')], 'wc1')
    backend.emit('user.updated', { userId: USER_ID })
    await vi.waitFor(() => expect(backend.count('GET /work-centers')).toBe(1))
    await sleep(50)
    expect(store.getWorkCenterId()).toBe('wc1')
  })

  it('brings a newly assigned work center to the screen that has none', async () => {
    const { backend, core } = await signedIn([workCenters(), workCenters('wc1', 'wc2')])
    const key = workCentersListOptions(core.api, { status: 'active' }).queryKey
    const visible = () =>
      (core.queryClient.getQueryData(key) as { data: { _id: string }[] } | undefined)?.data.map(
        workCenter => workCenter._id,
      )
    await core.queryClient.fetchQuery(workCentersListOptions(core.api, { status: 'active' }))
    expect(visible()).toEqual([])

    backend.emit('user.updated', { userId: USER_ID })
    await vi.waitFor(() => expect(visible()).toEqual(['wc1', 'wc2']))
  })

  it('clears the station once the server answers again, when a screen shows the list', async () => {
    const unavailable = errorReply(503, 'proxy.unavailable')
    const { backend, core, store } = await signedIn(
      [workCenters('wc1', 'wc2'), unavailable, unavailable, workCenters('wc2')],
      'wc1',
    )
    // the station screen observes the list with the panel's recovery rule
    const observer = new QueryObserver(core.queryClient, visibleWorkCentersQuery(core.api, 50))
    cleanups.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
    expect(backend.count('GET /work-centers')).toBe(1)

    backend.emit('user.updated', { userId: USER_ID })
    await vi.waitFor(() => expect(store.getWorkCenterId()).toBeNull())
    expect(backend.count('GET /work-centers')).toBe(4)
    expect(observer.getCurrentResult().data?.data.map(workCenter => workCenter._id)).toEqual([
      'wc2',
    ])
  })
})
