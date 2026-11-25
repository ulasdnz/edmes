export function startVersionCheck(options: {
  currentVersion: string
  url: string
  intervalMs?: number
  onMismatch: (serverVersion: string) => void
}): { checkNow(): Promise<void>; stop(): void } {
  let lastReported: string | undefined

  async function checkNow(): Promise<void> {
    try {
      const response = await fetch(options.url, { cache: 'no-store' })
      if (!response.ok) return
      const body: unknown = await response.json()
      const version =
        typeof body === 'object' && body !== null && 'version' in body ? body.version : undefined
      if (typeof version !== 'string' || version === options.currentVersion) return
      if (version === lastReported) return
      lastReported = version
      options.onMismatch(version)
    } catch {
      // server down or not JSON: stay silent, the next check tries again
    }
  }

  const timer = setInterval(() => void checkNow(), options.intervalMs ?? 300_000)
  return { checkNow, stop: () => clearInterval(timer) }
}
