import { type ApiClient, createApiClient, toApiError } from '@mes/api-client'
import { QueryClient } from '@tanstack/react-query'
import { createRealtimeClient, invalidationMap, type RealtimeClient } from '../realtime'
import { createSessionStore, type SessionStatus, type SessionStore } from '../session'

export interface AppCore {
  api: ApiClient
  session: SessionStore
  queryClient: QueryClient
  realtime: RealtimeClient
}

export interface AppCoreOptions {
  app: 'web' | 'operator'
  storage: Storage
  getLocale: () => string
  realtimeUrl?: string
  apiBaseUrl?: string
  heartbeatMs?: number
  onRoomsDenied?: (denied: string[]) => void
}

const RETRIED_KINDS = new Set(['network', 'timeout'])
const HEARTBEAT_STATUSES = new Set<SessionStatus>(['authenticated', 'unreachable'])

export function createAppCore(options: AppCoreOptions): AppCore {
  const {
    app,
    storage,
    getLocale,
    realtimeUrl,
    apiBaseUrl,
    heartbeatMs = 30000,
    onRoomsDenied,
  } = options

  const session = createSessionStore({
    storageKey: app === 'web' ? 'edmes.web.token' : 'edmes.operator.token',
    storage,
    api: () => api,
  })

  const api = createApiClient({
    baseUrl: apiBaseUrl,
    getToken: session.getToken,
    getLocale,
    onUnauthorized: session.logout,
  })

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          failureCount < 2 && RETRIED_KINDS.has(toApiError(error).kind),
      },
      mutations: { retry: false },
    },
  })

  const realtime = createRealtimeClient({
    url: realtimeUrl,
    getToken: session.getToken,
    queryClient,
    invalidation: invalidationMap,
    onUnauthenticated: session.logout,
    onRoomsDenied,
  })

  const refreshIf =
    (matches: (payload: Record<string, unknown>) => boolean) =>
    (payload: Record<string, unknown>) => {
      if (matches(payload)) void session.refresh()
    }
  const holdsRole = refreshIf(payload => {
    const roles: readonly string[] = session.getState().user?.roles ?? []
    return typeof payload.roleId === 'string' && roles.includes(payload.roleId)
  })
  // The gateway sends an entity event only to its entity room.
  realtime.subscribe(['role', 'user'])
  for (const type of ['role.created', 'role.updated', 'role.deleted']) realtime.on(type, holdsRole)
  realtime.on(
    'user.updated',
    refreshIf(payload => {
      const userId = session.getState().user?._id
      return userId !== undefined && payload.userId === userId
    }),
  )

  let heartbeat: ReturnType<typeof setInterval> | undefined
  let previous = session.getState().status

  session.subscribe(({ status }) => {
    if (status === previous) return
    previous = status
    if (status === 'authenticated') realtime.start()
    if (status === 'anonymous') {
      realtime.stop()
      queryClient.clear()
    }
    if (HEARTBEAT_STATUSES.has(status)) {
      heartbeat ??= setInterval(() => void session.refresh(), heartbeatMs)
    } else {
      clearInterval(heartbeat)
      heartbeat = undefined
    }
  })

  return { api, session, queryClient, realtime }
}
