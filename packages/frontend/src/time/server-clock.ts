export interface ServerClock {
  now(): Date
  toIso(): string
}

export function createServerClock(serverTimeIso: string): ServerClock {
  const skewMs = Date.parse(serverTimeIso) - Date.now()
  const now = () => new Date(Date.now() + skewMs)
  return { now, toIso: () => now().toISOString() }
}
