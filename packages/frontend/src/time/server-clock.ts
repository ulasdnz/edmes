export interface ServerClock {
  now(): Date
  toIso(): string
  // A moment the device recorded with its own clock, moved onto the server's
  fromDevice(deviceTime: Date): Date
}

export function createServerClock(serverTimeIso: string): ServerClock {
  const skewMs = Date.parse(serverTimeIso) - Date.now()
  const now = () => new Date(Date.now() + skewMs)
  return {
    now,
    toIso: () => now().toISOString(),
    fromDevice: deviceTime => new Date(deviceTime.getTime() + skewMs),
  }
}
