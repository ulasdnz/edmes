import type { PrivilegeCode } from '@mes/privileges'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import type { RealtimeStatus } from '../realtime'
import type { SessionState, SessionStatus } from '../session'
import { type Connection, connectionFor } from './connection'
import type { AppCore } from './create-app-core'

const AppCoreContext = createContext<AppCore | null>(null)

export function AppCoreProvider(props: { core: AppCore; children: ReactNode }): ReactNode {
  return (
    <AppCoreContext value={props.core}>
      <QueryClientProvider client={props.core.queryClient}>{props.children}</QueryClientProvider>
    </AppCoreContext>
  )
}

export function useAppCore(): AppCore {
  const core = useContext(AppCoreContext)
  if (!core) throw new Error('useAppCore must be used inside AppCoreProvider')
  return core
}

export function useSession(): SessionState {
  const { session } = useAppCore()
  return useSyncExternalStore(session.subscribe, session.getState)
}

export function useCan(): (code: PrivilegeCode) => boolean {
  const { permissions } = useSession()
  return useCallback(
    (code: PrivilegeCode) => permissions.includes('*') || permissions.includes(code),
    [permissions],
  )
}

export function useRealtimeStatus(): { status: RealtimeStatus; since: Date } {
  const { realtime } = useAppCore()
  const status = useSyncExternalStore(realtime.onStatus, realtime.getStatus)
  const since = useSyncExternalStore(realtime.onStatus, realtime.getStatusSince)
  return { status, since }
}

export function useRealtimeRooms(rooms: readonly string[]): void {
  const { realtime } = useAppCore()
  const key = [...rooms].sort().join('\n')
  useEffect(() => realtime.subscribe(key ? key.split('\n') : []), [realtime, key])
}

// The moment the session found the server unreachable; the realtime client keeps its own.
function useUnreachableSince(status: SessionStatus): Date | null {
  const unreachable = status === 'unreachable'
  const [since, setSince] = useState<Date | null>(() => (unreachable ? new Date() : null))
  useEffect(() => {
    setSince(current => (unreachable ? (current ?? new Date()) : null))
  }, [unreachable])
  return unreachable ? since : null
}

export function useConnection(): Connection {
  const { status } = useSession()
  const realtime = useRealtimeStatus()
  const unreachableSince = useUnreachableSince(status)
  return connectionFor({
    session: status,
    unreachableSince,
    realtime: realtime.status,
    realtimeSince: realtime.since,
  })
}
