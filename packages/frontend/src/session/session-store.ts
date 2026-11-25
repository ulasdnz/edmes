import { type ApiClient, ApiError, type paths, toApiError } from '@mes/api-client'
import type { PrivilegeCode } from '@mes/privileges'
import { createStore } from 'zustand/vanilla'
import { createServerClock, type ServerClock } from '../time'

type MeResponse = paths['/users/me']['get']['responses'][200]['content']['application/json']

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous' | 'unreachable'
export type SessionUser = MeResponse['data']

export interface SessionState {
  status: SessionStatus
  user: SessionUser | null
  permissions: readonly string[]
  plantTimezone: string | null
  serverClock: ServerClock | null
}

export type TokenStorageKey = 'edmes.web.token' | 'edmes.operator.token'

export interface SessionStore {
  getState(): SessionState
  subscribe(listener: (state: SessionState) => void): () => void
  getToken(): string | null
  bootstrap(): Promise<void>
  login(credentials: { email: string; password: string }): Promise<void>
  refresh(): Promise<void>
  logout(): void
  can(code: PrivilegeCode): boolean
}

export interface SessionStoreOptions {
  storageKey: TokenStorageKey
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  api: () => ApiClient
}

const ANONYMOUS: SessionState = {
  status: 'anonymous',
  user: null,
  permissions: [],
  plantTimezone: null,
  serverClock: null,
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const { storageKey, storage, api } = options
  const store = createStore<SessionState>()(() => ({ ...ANONYMOUS, status: 'unknown' }))

  const getToken = () => storage.getItem(storageKey)

  function logout() {
    storage.removeItem(storageKey)
    store.setState(ANONYMOUS)
  }

  async function fetchMe(): Promise<MeResponse> {
    const { data } = await api().fetchClient.GET('/users/me')
    if (!data) {
      throw new ApiError({ kind: 'http', status: 200, code: 'client.unexpected_response' })
    }
    return data
  }

  function apply(me: MeResponse) {
    store.setState({
      status: 'authenticated',
      user: me.data,
      permissions: me.meta.permissions,
      plantTimezone: me.meta.plantTimezone,
      serverClock: createServerClock(me.meta.serverTime),
    })
  }

  async function load() {
    const token = getToken()
    try {
      const me = await fetchMe()
      if (getToken() === token) apply(me)
    } catch (error) {
      const failure = toApiError(error)
      if (failure.kind === 'aborted' || getToken() !== token) return
      if (failure.status === 401 && failure.code === 'auth.unauthenticated') logout()
      else store.setState({ status: 'unreachable' })
    }
  }

  async function bootstrap() {
    if (getToken() === null) {
      logout()
      return
    }
    await load()
  }

  async function login(credentials: { email: string; password: string }) {
    let token: string | undefined
    try {
      const { data } = await api().fetchClient.POST('/auth/login', { body: credentials })
      token = data?.data.token
    } catch (error) {
      throw toApiError(error)
    }
    if (!token) {
      throw new ApiError({ kind: 'http', status: 200, code: 'client.unexpected_response' })
    }
    storage.setItem(storageKey, token)
    try {
      apply(await fetchMe())
    } catch (error) {
      if (getToken() === token) logout()
      throw toApiError(error)
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    getToken,
    bootstrap,
    login,
    refresh: load,
    logout,
    can: code => {
      const { permissions } = store.getState()
      return permissions.includes('*') || permissions.includes(code)
    },
  }
}
