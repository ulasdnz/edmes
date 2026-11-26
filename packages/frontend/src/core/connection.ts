import type { RealtimeStatus } from '../realtime'
import type { SessionStatus } from '../session'
import type { ServerClock } from '../time/server-clock'

export type ConnectionStatus = 'live' | 'reconnecting' | 'offline'

export interface Connection {
  status: ConnectionStatus
  // When it went offline; null unless offline.
  since: Date | null
}

export function connectionFor(input: {
  session: SessionStatus
  unreachableSince: Date | null
  realtime: RealtimeStatus
  realtimeSince: Date
  // The moments above are taken from the device clock; shown, they must be server time
  clock?: ServerClock | null
}): Connection {
  if (input.session === 'unreachable' || input.realtime === 'unavailable') {
    const candidates = [
      input.session === 'unreachable' ? input.unreachableSince : null,
      input.realtime === 'unavailable' ? input.realtimeSince : null,
    ]
    const since =
      candidates.reduce<Date | null>(
        (earliest, value) => (value && (!earliest || value < earliest) ? value : earliest),
        null,
      ) ?? new Date()
    return { status: 'offline', since: input.clock ? input.clock.fromDevice(since) : since }
  }
  if (input.realtime === 'connecting' || input.realtime === 'reconnecting') {
    return { status: 'reconnecting', since: null }
  }
  return { status: 'live', since: null }
}
