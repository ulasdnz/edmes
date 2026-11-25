import { expect, it, vi } from 'vitest'
import { installChunkReloadGuard } from './chunk-reload-guard'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

it('reloads once on a failed chunk load and never loops', () => {
  const target = new EventTarget()
  const reload = vi.fn()
  installChunkReloadGuard({ storage: memoryStorage(), reload, target })
  target.dispatchEvent(new Event('vite:preloadError'))
  target.dispatchEvent(new Event('vite:preloadError'))
  expect(reload).toHaveBeenCalledTimes(1)
})

it('does not reload again after the page reloaded with the mark already set', () => {
  const storage = memoryStorage()
  const first = new EventTarget()
  installChunkReloadGuard({ storage, reload: vi.fn(), target: first })
  first.dispatchEvent(new Event('vite:preloadError'))

  const second = new EventTarget()
  const reload = vi.fn()
  installChunkReloadGuard({ storage, reload, target: second })
  second.dispatchEvent(new Event('vite:preloadError'))
  expect(reload).not.toHaveBeenCalled()
})

it('prevents the default error so the failed import is not rethrown', () => {
  const target = new EventTarget()
  installChunkReloadGuard({ storage: memoryStorage(), reload: vi.fn(), target })
  const event = new Event('vite:preloadError', { cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})

it('does not reload and does not throw when the storage throws', () => {
  const target = new EventTarget()
  const reload = vi.fn()
  const broken = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    },
  }
  installChunkReloadGuard({ storage: broken, reload, target })
  expect(() => target.dispatchEvent(new Event('vite:preloadError'))).not.toThrow()
  expect(reload).not.toHaveBeenCalled()
})
