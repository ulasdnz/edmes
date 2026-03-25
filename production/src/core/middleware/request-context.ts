/**
 * Request context middleware — re-exported from @mes/core.
 *
 * Provides AsyncLocalStorage-based request context (traceId, ip, userId)
 * shared across the async call chain.
 */

export type { RequestContext } from '@mes/core'
export {
  als,
  contextMiddleware,
  getContext,
  getTraceId,
  setUserId,
} from '@mes/core'
