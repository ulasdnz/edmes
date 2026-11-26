import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reloadWhenIdle } from './reload-when-idle'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('reloads only after the app stops being busy', () => {
  const reload = vi.fn()
  const isBusy = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false)
  reloadWhenIdle({ isBusy, reload, pollMs: 5000 })
  vi.advanceTimersByTime(5000)
  vi.advanceTimersByTime(5000)
  expect(reload).not.toHaveBeenCalled()
  vi.advanceTimersByTime(5000)
  expect(reload).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(60_000)
  expect(reload).toHaveBeenCalledTimes(1)
})

it('can be cancelled', () => {
  const reload = vi.fn()
  const cancel = reloadWhenIdle({ isBusy: () => false, reload })
  cancel()
  vi.advanceTimersByTime(60_000)
  expect(reload).not.toHaveBeenCalled()
})
