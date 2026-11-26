import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createServerClock } from './server-clock'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('follows the server when the tablet clock is behind', () => {
  vi.setSystemTime(new Date('2026-04-04T11:58:00.000Z'))
  const clock = createServerClock('2026-04-04T12:00:00.000Z')
  vi.advanceTimersByTime(1000)
  expect(clock.toIso()).toBe('2026-04-04T12:00:01.000Z')
  expect(clock.now().toISOString()).toBe('2026-04-04T12:00:01.000Z')
})
