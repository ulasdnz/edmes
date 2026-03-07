/**
 * Request context middleware — re-exported from @mes/core.
 *
 * Provides AsyncLocalStorage-based request context (traceId, ip, userId)
 * shared across the async call chain.
 */

export {
  contextMiddleware,
  getContext,
  getTraceId,
  setUserId,
  als,
} from '@mes/core'
export type { RequestContext } from '@mes/core'
