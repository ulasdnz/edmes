import { expect, it, vi } from 'vitest'
import { installChunkReloadGuard } from './chunk-reload-guard'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

// What Vite's preload helper dispatches: it rethrows the error unless the default is prevented
const preloadError = () => new Event('vite:preloadError', { cancelable: true })

it('reloads once on a failed chunk load and never loops', () => {
  const target = new EventTarget()
  const reload = vi.fn()
  installChunkReloadGuard({ storage: memoryStorage(), reload, target, version: '1.0.0' })
  target.dispatchEvent(preloadError())
  target.dispatchEvent(preloadError())
  expect(reload).toHaveBeenCalledTimes(1)
})

it('does not reload again after the page reloaded into the same version', () => {
  const storage = memoryStorage()
  const first = new EventTarget()
  installChunkReloadGuard({ storage, reload: vi.fn(), target: first, version: '1.0.0' })
  first.dispatchEvent(preloadError())

  const second = new EventTarget()
  const reload = vi.fn()
  installChunkReloadGuard({ storage, reload, target: second, version: '1.0.0' })
  const event = preloadError()
  second.dispatchEvent(event)
  expect(reload).not.toHaveBeenCalled()
  // no reload follows, so the import fails as it would without the guard
  expect(event.defaultPrevented).toBe(false)
})

it('reloads once again when a later version of the same tab loses its chunks', () => {
  const storage = memoryStorage()
  // 1.0.0 is open when 1.1.0 is installed: the tab reloads into 1.1.0
  const first = new EventTarget()
  installChunkReloadGuard({ storage, reload: vi.fn(), target: first, version: '1.0.0' })
  first.dispatchEvent(preloadError())

  // weeks later, in the same tab session, 1.2.0 is installed
  const second = new EventTarget()
  const reload = vi.fn()
  installChunkReloadGuard({ storage, reload, target: second, version: '1.1.0' })
  const event = preloadError()
  second.dispatchEvent(event)
  expect(reload).toHaveBeenCalledTimes(1)
  expect(event.defaultPrevented).toBe(true)

  // the page reloaded into 1.1.0 again, the chunk is still missing: no loop
  const third = new EventTarget()
  const again = vi.fn()
  installChunkReloadGuard({ storage, reload: again, target: third, version: '1.1.0' })
  third.dispatchEvent(preloadError())
  expect(again).not.toHaveBeenCalled()
})

it('prevents the default error so the failed import is not rethrown', () => {
  const target = new EventTarget()
  installChunkReloadGuard({ storage: memoryStorage(), reload: vi.fn(), target, version: '1.0.0' })
  const event = preloadError()
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})

it('does not reload, does not prevent the error and does not throw when the storage throws', () => {
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
  installChunkReloadGuard({ storage: broken, reload, target, version: '1.0.0' })
  const event = preloadError()
  expect(() => target.dispatchEvent(event)).not.toThrow()
  expect(reload).not.toHaveBeenCalled()
  expect(event.defaultPrevented).toBe(false)
})
