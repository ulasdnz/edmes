import type { PrivilegeCode } from '@mes/privileges'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react'
import type { RealtimeStatus } from '../realtime'
import type { SessionState } from '../session'
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
