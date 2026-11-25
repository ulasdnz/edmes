import { describe, expect, it } from 'vitest'
import { readPrefs, writePrefs } from './prefs'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>()
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  }
}

describe('prefs', () => {
  it('keeps one record per user', () => {
    const storage = memoryStorage()
    writePrefs(storage, 'u1', { sidebar: 'rail' })
    expect(readPrefs(storage, 'u1')).toEqual({ sidebar: 'rail' })
    expect(readPrefs(storage, 'u2')).toEqual({ sidebar: 'full' })
  })

  it('falls back to the default for a broken record', () => {
    const storage = memoryStorage()
    storage.setItem('edmes.web.prefs.u3', '{not json')
    expect(readPrefs(storage, 'u3')).toEqual({ sidebar: 'full' })
    storage.setItem('edmes.web.prefs.u4', '{"sidebar":"wide"}')
    expect(readPrefs(storage, 'u4')).toEqual({ sidebar: 'full' })
  })

  it('works when storage is unavailable', () => {
    const blocked = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readPrefs(blocked, 'u1')).toEqual({ sidebar: 'full' })
    expect(() => writePrefs(blocked, 'u1', { sidebar: 'rail' })).not.toThrow()
  })
})
