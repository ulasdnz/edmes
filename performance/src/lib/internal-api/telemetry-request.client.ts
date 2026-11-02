import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { CustomError, getTraceId } from '@mes/core'
import { config } from '../../config/index.js'
import { logger } from '../logger.js'

// A telemetry that accepts the connection and never answers counts as unreachable after this long,
// instead of after undici's 300 s default
const REQUEST_TIMEOUT_MS = 5000

export async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${config.INTERNAL_API_TELEMETRY}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        ...(init?.headers ?? {}),
        'x-trace-id': getTraceId() ?? '',
        [INTERNAL_TOKEN_HEADER]: config.INTERNAL_API_TOKEN,
        accept: 'application/json',
      },
    })
    if (res.status === 404) return null
    // A failed answer is not an empty one; callers must not read it as no samples
    if (!res.ok) {
      logger.warn('Telemetry internal fetch failed', {
        event: 'internal_api.telemetry.fetch_failed',
        path,
        status: res.status,
      })
      throw new CustomError(503, 'error.telemetry_unreachable')
    }
    const body = (await res.json()) as { data?: T }
    return body.data ?? null
  } catch (err) {
    if (err instanceof CustomError) throw err
    logger.warn('Telemetry internal fetch errored', {
      event: 'internal_api.telemetry.fetch_errored',
      path,
      error: err instanceof Error ? err.message : err,
    })
    throw new CustomError(503, 'error.telemetry_unreachable')
  }
}
