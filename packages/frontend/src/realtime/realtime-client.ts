import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
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
  timer: ReturnType<typeof setTimeout>
  pending: boolean
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
  let connectedBefore = false
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

  function join() {
    if (!socket.connected) return
    const rooms = [...roomCounts.keys()]
    socket.emit('join', { rooms }, (ack: unknown) => {
      const allowed = isRecord(ack) && Array.isArray(ack.rooms) ? ack.rooms : []
      const denied = rooms.filter(room => !allowed.includes(room))
      if (denied.length > 0) onRoomsDenied?.(denied)
    })
  }

  function scheduleJoin() {
    if (joinScheduled) return
    joinScheduled = true
    queueMicrotask(() => {
      joinScheduled = false
      join()
    })
  }

  function invalidate(queryHash: string, queryKey: QueryKey) {
    void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' })
    const throttle: Throttle = {
      pending: false,
      timer: setTimeout(() => {
        throttles.delete(queryHash)
        if (throttle.pending) invalidate(queryHash, queryKey)
      }, throttleMs),
    }
    throttles.set(queryHash, throttle)
  }

  function refetchThrottled(query: Query) {
    const throttle = throttles.get(query.queryHash)
    if (throttle) {
      throttle.pending = true
      return
    }
    invalidate(query.queryHash, query.queryKey)
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
    join()
    if (connectedBefore) void queryClient.invalidateQueries({ type: 'active' })
    connectedBefore = true
  })

  socket.on('connect_error', error => {
    if (!started) return
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
