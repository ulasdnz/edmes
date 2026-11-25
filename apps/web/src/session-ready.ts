import type { SessionStore } from '@mes/frontend/session'

// Resolves once the session has left `unknown`, so a route guard can wait for start-up
// instead of the first render waiting for the server.
export function whenSessionKnown(session: Pick<SessionStore, 'getState' | 'subscribe'>) {
  if (session.getState().status !== 'unknown') return Promise.resolve()
  return new Promise<void>(resolve => {
    const stop = session.subscribe(state => {
      if (state.status === 'unknown') return
      stop()
      resolve()
    })
  })
}
