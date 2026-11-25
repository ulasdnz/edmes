import type { RealtimeStatus } from '../realtime'
import type { SessionStatus } from '../session'

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
    return { status: 'offline', since }
  }
  if (input.realtime === 'connecting' || input.realtime === 'reconnecting') {
    return { status: 'reconnecting', since: null }
  }
  return { status: 'live', since: null }
}
