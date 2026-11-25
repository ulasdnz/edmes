const REQUEST_TIMEOUT_MS = 10_000

export function startVersionCheck(options: {
  currentVersion: string
  url: string
  intervalMs?: number
  onMismatch: (serverVersion: string) => void
}): { checkNow(): Promise<void>; stop(): void } {
  let lastReported: string | undefined
  let stopped = false
  let inFlight: Promise<void> | undefined
  let abort: AbortController | undefined

  async function fetchServerVersion(signal: AbortSignal): Promise<string | undefined> {
    try {
      const response = await fetch(options.url, { cache: 'no-store', signal })
      if (!response.ok) return undefined
      const body: unknown = await response.json()
      const version =
        typeof body === 'object' && body !== null && 'version' in body ? body.version : undefined
      return typeof version === 'string' ? version : undefined
    } catch {
      return undefined
    }
  }

  async function run(): Promise<void> {
    const controller = new AbortController()
    abort = controller
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let version: string | undefined
    try {
      version = await fetchServerVersion(controller.signal)
    } finally {
      clearTimeout(timer)
      abort = undefined
      inFlight = undefined
    }
    if (stopped || !version || version === options.currentVersion || version === lastReported) {
      return
    }
    options.onMismatch(version)
    lastReported = version
  }

  function checkNow(): Promise<void> {
    if (stopped) return Promise.resolve()
    inFlight ??= run()
    return inFlight
  }

  const timer = setInterval(() => void checkNow(), options.intervalMs ?? 300_000)
  return {
    checkNow,
    stop: () => {
      stopped = true
      clearInterval(timer)
      abort?.abort()
    },
  }
}
