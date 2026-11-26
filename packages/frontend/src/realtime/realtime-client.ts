import type { Query, QueryClient } from '@tanstack/react-query'
import { io, type ManagerOptions, type SocketOptions } from 'socket.io-client'
import {
  eventWorkCenterIds,
  type InvalidationMap,
  pathsForEvent,
  queryMatchesEvent,
} from './invalidation'

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unavailable'

export interface RealtimeClient {
  start(): void
  stop(): void
  getStatus(): RealtimeStatus
  getStatusSince(): Date
  onStatus(listener: (status: RealtimeStatus) => void): () => void
  retryNow(): void
  subscribe(rooms: readonly string[]): () => void
  on(eventType: string, handler: (payload: Record<string, unknown>) => void): () => void
}

export interface RealtimeClientOptions {
  url?: string
  getToken: () => string | null
  queryClient: QueryClient
  invalidation: InvalidationMap
  onUnauthenticated: () => void
  onRoomsDenied?: (denied: string[]) => void
  retryDelayMs?: number
  throttleMs?: number
}

interface Throttle {
  timer?: ReturnType<typeof setTimeout>
  pending: boolean
  waiting: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const {
    url,
    getToken,
    queryClient,
    invalidation,
    onUnauthenticated,
    onRoomsDenied,
    retryDelayMs = 2000,
    throttleMs = 2000,
  } = options

  const socketOptions: Partial<ManagerOptions & SocketOptions> = {
    transports: ['websocket'],
    autoConnect: false,
    auth: cb => cb({ token: getToken() }),
  }
  const socket = url === undefined ? io(socketOptions) : io(url, socketOptions)

  let status: RealtimeStatus = 'idle'
  let since = new Date()
  let started = false
  let cleanFirstAttempt = true
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let joinScheduled = false
  const statusListeners = new Set<(status: RealtimeStatus) => void>()
  const handlers = new Map<string, Set<(payload: Record<string, unknown>) => void>>()
  const roomCounts = new Map<string, number>()
  const throttles = new Map<string, Throttle>()

  function setStatus(next: RealtimeStatus) {
    if (next === status) return
    status = next
    since = new Date()
    for (const listener of statusListeners) listener(next)
  }

  function clearRetry() {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }

  function join(afterJoin?: () => void) {
    if (!socket.connected) return
    const rooms = [...roomCounts.keys()]
    socket.emit('join', { rooms }, (ack: unknown) => {
      const allowed = isRecord(ack) && Array.isArray(ack.rooms) ? ack.rooms : []
      const denied = rooms.filter(room => !allowed.includes(room))
      if (denied.length > 0) onRoomsDenied?.(denied)
      if (rooms.length > 0) afterJoin?.()
    })
    if (rooms.length === 0) afterJoin?.()
  }

  function scheduleJoin() {
    if (joinScheduled) return
    joinScheduled = true
    queueMicrotask(() => {
      joinScheduled = false
      join()
    })
  }

  // A change is refetched at most once per throttleMs, never by aborting a running fetch (its
  // answer may predate the change), and a change seen during a fetch is refetched after it.
  function flush(queryHash: string, throttle: Throttle) {
    if (throttles.get(queryHash) !== throttle || throttle.timer || throttle.waiting) return
    const query = queryClient.getQueryCache().get(queryHash)
    if (!throttle.pending || !query) {
      throttles.delete(queryHash)
      return
    }
    const running = query.state.fetchStatus === 'idle' ? undefined : query.promise
    if (running) {
      throttle.waiting = true
      const settled = () => {
        throttle.waiting = false
        flush(queryHash, throttle)
      }
      running.then(settled, settled)
      return
    }
    throttle.pending = false
    void queryClient.invalidateQueries(
      { queryKey: query.queryKey, exact: true, refetchType: 'active' },
      { cancelRefetch: false },
    )
    throttle.timer = setTimeout(() => {
      throttle.timer = undefined
      flush(queryHash, throttle)
    }, throttleMs)
  }

  function refetchThrottled(query: Query) {
    let throttle = throttles.get(query.queryHash)
    if (!throttle) {
      throttle = { pending: false, waiting: false }
      throttles.set(query.queryHash, throttle)
    }
    throttle.pending = true
    flush(query.queryHash, throttle)
  }

  function handleEvent(eventType: string, payload: unknown) {
    const data = isRecord(payload) ? payload : {}
    const paths = pathsForEvent(eventType, invalidation)
    if (paths.length > 0) {
      const eventIds = eventWorkCenterIds(data)
      for (const query of queryClient.getQueryCache().findAll()) {
        if (queryMatchesEvent(query, paths, eventIds)) refetchThrottled(query)
      }
    }
    for (const handler of handlers.get(eventType) ?? []) handler(data)
  }

  socket.on('connect', () => {
    clearRetry()
    setStatus('live')
    // Events sent while the socket was not connected are lost (no replay), so every connect but a
    // clean first attempt refetches what is on screen, after the rooms are joined.
    if (cleanFirstAttempt) join()
    else join(() => void queryClient.invalidateQueries({ type: 'active' }))
    cleanFirstAttempt = false
  })

  socket.on('connect_error', error => {
    if (!started) return
    cleanFirstAttempt = false
    if (error.message === 'auth.unauthenticated') {
      stop()
      onUnauthenticated()
      return
    }
    if (socket.active) {
      setStatus('reconnecting')
      return
    }
    setStatus('unavailable')
    clearRetry()
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      socket.connect()
    }, retryDelayMs)
  })

  socket.on('disconnect', reason => {
    if (!started) return
    setStatus('reconnecting')
    if (reason === 'io server disconnect') socket.connect()
  })

  socket.onAny(handleEvent)

  function start() {
    if (started) return
    started = true
    cleanFirstAttempt = true
    setStatus('connecting')
    socket.connect()
  }

  function stop() {
    started = false
    clearRetry()
    for (const throttle of throttles.values()) clearTimeout(throttle.timer)
    throttles.clear()
    socket.disconnect()
    setStatus('idle')
  }

  return {
    start,
    stop,
    getStatus: () => status,
    getStatusSince: () => since,
    onStatus(listener) {
      statusListeners.add(listener)
      return () => {
        statusListeners.delete(listener)
      }
    },
    retryNow() {
      if (!started || socket.connected) return
      clearRetry()
      socket.connect()
    },
    subscribe(rooms) {
      for (const room of rooms) roomCounts.set(room, (roomCounts.get(room) ?? 0) + 1)
      scheduleJoin()
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        for (const room of rooms) {
          const count = (roomCounts.get(room) ?? 0) - 1
          if (count > 0) roomCounts.set(room, count)
          else roomCounts.delete(room)
        }
        scheduleJoin()
      }
    },
    on(eventType, handler) {
      let set = handlers.get(eventType)
      if (!set) {
        set = new Set()
        handlers.set(eventType, set)
      }
      set.add(handler)
      return () => {
        set.delete(handler)
      }
    },
  }
}
