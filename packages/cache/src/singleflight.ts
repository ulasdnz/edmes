/**
 * Singleflight — in-flight request deduplication.
 *
 * Prevents thundering herd: when N concurrent calls request the same key,
 * only the first executes `fn`. The remaining N-1 await its result.
 *
 * Inspired by Go's `sync/singleflight` and the legacy `request-promise-cache.js`.
 * Zero dependencies, closure-based (no classes).
 */

const flights = new Map<string, Promise<unknown>>()

/**
 * Execute `fn` at most once per unique `key` at any given time.
 *
 * If a flight for `key` is already in progress, returns the existing promise.
 * Once the flight completes (success or failure), the key is released for future calls.
 *
 * @example
 * ```ts
 * const user = await singleflight('user:abc123', () => UserModel.findById('abc123'));
 * ```
 */
export const singleflight = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const inflight = flights.get(key)
  if (inflight) return inflight as Promise<T>

  const promise = fn().finally(() => {
    flights.delete(key)
  })

  flights.set(key, promise)
  return promise
}

/**
 * Check whether a flight is currently in progress for the given key.
 * Useful for diagnostics / testing.
 */
export const isInflight = (key: string): boolean => flights.has(key)

/**
 * Number of currently active flights.
 * Useful for health checks and monitoring.
 */
export const inflightCount = (): number => flights.size
