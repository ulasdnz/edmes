import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { CustomError, getTraceId } from '@mes/core'
import { config } from '../../config/index.js'
import { logger } from '../logger.js'

export interface RequestOptions {
  // A caller that logs a failure itself, from the cause the error carries, lowers the request's own
  // line to debug
  failureLogLevel?: 'warn' | 'debug'
}

const TAG_NOT_BINARY = 'historian.binary_only'

// Telemetry was asked for the states of a tag that is not binary
export const isTagNotBinary = (err: unknown): boolean =>
  err instanceof CustomError && err.message === TAG_NOT_BINARY

// A caller that must not wait long passes a signal in init, such as AbortSignal.timeout(ms); an
// aborted request counts as unreachable
export async function request<T>(
  path: string,
  init?: RequestInit,
  { failureLogLevel = 'warn' }: RequestOptions = {},
): Promise<T | null> {
  try {
    const res = await fetch(`${config.INTERNAL_API_TELEMETRY}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        'x-trace-id': getTraceId() ?? '',
        [INTERNAL_TOKEN_HEADER]: config.INTERNAL_API_TOKEN,
        accept: 'application/json',
      },
    })
    if (res.status === 404) return null
    // Telemetry keeps no states of a tag that is not binary: an answer about the tag, not a failure
    // to reach telemetry, so the caller logs it
    if (res.status === 400 && (await errorCode(res)) === TAG_NOT_BINARY) {
      throw new CustomError(400, TAG_NOT_BINARY)
    }
    // A failed answer is not an empty one; callers must not read it as no samples
    if (!res.ok) {
      logger[failureLogLevel]('Telemetry internal fetch failed', {
        event: 'internal_api.telemetry.fetch_failed',
        path,
        status: res.status,
      })
      throw unreachable(`HTTP ${res.status}`)
    }
    const body = (await res.json()) as { data?: T }
    return body.data ?? null
  } catch (err) {
    if (err instanceof CustomError) throw err
    logger[failureLogLevel]('Telemetry internal fetch errored', {
      event: 'internal_api.telemetry.fetch_errored',
      path,
      error: err instanceof Error ? err.message : err,
    })
    throw unreachable(describeFetchError(err))
  }
}

async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null
  return body?.error?.code
}

// The error's cause says why telemetry could not answer: the HTTP status, the fetch error or the
// timeout
function unreachable(cause: string): CustomError {
  const err = new CustomError(503, 'error.telemetry_unreachable')
  err.cause = cause
  return err
}

// A failed fetch says only "fetch failed"; the reason, such as a refused connection, is its cause
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message
}
