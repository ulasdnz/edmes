import type { ApiClient } from '@mes/api-client'
import { describe, expect, it } from 'vitest'
import { createSessionStore } from '../session'
import { whenSessionKnown } from './session-ready'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const items = new Map<string, string>()
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: key => void items.delete(key),
  }
}

function newSession() {
  return createSessionStore({
    storageKey: 'edmes.web.token',
    storage: memoryStorage(),
    api: (): ApiClient => {
      throw new Error('a session without a token asks no server')
    },
  })
}

describe('whenSessionKnown', () => {
  it('waits while the session is still unknown', async () => {
    const session = newSession()
    let settled = false
    const ready = whenSessionKnown(session).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(session.getState().status).toBe('unknown')
    expect(settled).toBe(false)
    await session.bootstrap()
    await ready
    expect(session.getState().status).toBe('anonymous')
  })

  it('does not wait for a session that is already known', async () => {
    const session = newSession()
    await session.bootstrap()
    await expect(whenSessionKnown(session)).resolves.toBeUndefined()
  })
})
