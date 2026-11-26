import { describe, expect, it, vi } from 'vitest'
import { createServerClock } from '../time/server-clock'
import { connectionFor } from './connection'

const at = (time: string) => new Date(`2026-11-25T${time}:00.000Z`)

describe('connectionFor', () => {
  it('is live while the session holds and realtime is connected', () => {
    expect(
      connectionFor({
        session: 'authenticated',
        unreachableSince: null,
        realtime: 'live',
        realtimeSince: at('08:00'),
      }),
    ).toEqual({ status: 'live', since: null })
  })

  it('is reconnecting while realtime connects or reconnects', () => {
    for (const realtime of ['connecting', 'reconnecting'] as const) {
      expect(
        connectionFor({
          session: 'authenticated',
          unreachableSince: null,
          realtime,
          realtimeSince: at('08:00'),
        }),
      ).toEqual({ status: 'reconnecting', since: null })
    }
  })

  it('is offline since the server became unreachable', () => {
    expect(
      connectionFor({
        session: 'unreachable',
        unreachableSince: at('08:10'),
        realtime: 'reconnecting',
        realtimeSince: at('08:05'),
      }),
    ).toEqual({ status: 'offline', since: at('08:10') })
  })

  it('is offline since realtime became unavailable', () => {
    expect(
      connectionFor({
        session: 'authenticated',
        unreachableSince: null,
        realtime: 'unavailable',
        realtimeSince: at('08:05'),
      }),
    ).toEqual({ status: 'offline', since: at('08:05') })
  })

  it('is offline since the earlier of the two', () => {
    expect(
      connectionFor({
        session: 'unreachable',
        unreachableSince: at('08:10'),
        realtime: 'unavailable',
        realtimeSince: at('08:05'),
      }),
    ).toEqual({ status: 'offline', since: at('08:05') })
  })

  it('is offline from now when the moment is not known yet', () => {
    const before = Date.now()
    const { status, since } = connectionFor({
      session: 'unreachable',
      unreachableSince: null,
      realtime: 'live',
      realtimeSince: at('08:00'),
    })
    expect(status).toBe('offline')
    expect(since?.getTime()).toBeGreaterThanOrEqual(before)
  })
  it('shows the offline moment in server time when the tablet clock is off', () => {
    vi.useFakeTimers()
    // The tablet is two minutes behind the server
    vi.setSystemTime(at('08:00'))
    const clock = createServerClock(at('08:02').toISOString())
    try {
      expect(
        connectionFor({
          session: 'unreachable',
          unreachableSince: at('08:10'),
          realtime: 'live',
          realtimeSince: at('08:00'),
          clock,
        }),
      ).toEqual({ status: 'offline', since: at('08:12') })
    } finally {
      vi.useRealTimers()
    }
  })
})
