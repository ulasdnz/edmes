import { toApiError } from '@mes/api-client'

const RECOVERY_MS = 5000
const QUICK_RETRIES = 2

// The server did not answer (an outage, or the proxy during an upgrade), as opposed to an answer
// that will not change by asking again.
export function isServerUnavailable(error: unknown): boolean {
  if (error === null || error === undefined) return false
  const failure = toApiError(error)
  return failure.kind === 'network' || failure.kind === 'timeout' || failure.status >= 500
}

// Nobody may be at the tablet: a query the server could not answer asks again by itself, every
// few seconds, for as long as it is observed. The core's two quick retries of a network failure
// or a timeout come first. Retrying keeps the query pending with the failure as its
// failureReason, so a screen can keep saying the server is unreachable without flickering.
export function recoverWhileUnavailable(ms = RECOVERY_MS) {
  return {
    retry: (_failureCount: number, error: unknown) => isServerUnavailable(error),
    retryDelay: (failureCount: number, error: unknown) => {
      const { kind } = toApiError(error)
      const quick = failureCount < QUICK_RETRIES && (kind === 'network' || kind === 'timeout')
      return quick ? Math.min(1000 * 2 ** failureCount, ms) : ms
    },
  }
}

// What a screen shows instead of the query's data: the server is unreachable while the query
// is retrying after one, it failed for good, it is loading, or nothing.
export function queryProblem(query: {
  isPending: boolean
  isError: boolean
  error: unknown
  failureReason: unknown
}): 'unavailable' | 'failed' | 'loading' | null {
  if (query.isError) return isServerUnavailable(query.error) ? 'unavailable' : 'failed'
  if (isServerUnavailable(query.failureReason)) return 'unavailable'
  return query.isPending ? 'loading' : null
}
