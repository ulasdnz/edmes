import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { CustomError, getTraceId } from '@mes/core'
import { config } from '../../config/index.js'
import { logger } from '../logger.js'

export interface RunModeMonitor {
  workCenterId: string
  runModeTagId: string
}

export interface MonitorsRequestOptions {
  // A caller that logs a failure itself, from the cause the error carries, lowers the request's own
  // line to debug
  failureLogLevel?: 'warn' | 'debug'
  // Aborts the request, such as when the caller stops at shutdown; an aborted request counts as
  // unreachable
  signal?: AbortSignal
}

// Throws when work-center cannot answer: a failed answer is not an empty list, and a caller that read
// it as no monitors would stop monitoring every work center
export async function listRunModeMonitors({
  failureLogLevel = 'warn',
  signal,
}: MonitorsRequestOptions = {}): Promise<RunModeMonitor[]> {
  try {
    const res = await fetch(
      `${config.INTERNAL_API_WORK_CENTER}/internal/v1/work-centers/run-mode-monitors`,
      {
        method: 'GET',
        headers: {
          'x-trace-id': getTraceId() ?? '',
          [INTERNAL_TOKEN_HEADER]: config.INTERNAL_API_TOKEN,
          accept: 'application/json',
        },
        signal,
      },
    )
    if (!res.ok) {
      logger[failureLogLevel]('Run-mode monitors fetch failed', {
        event: 'internal_api.run_mode_monitors.fetch_failed',
        status: res.status,
      })
      throw unreachable(`HTTP ${res.status}`)
    }
    const body = (await res.json()) as { data?: RunModeMonitor[] }
    return body.data ?? []
  } catch (err) {
    if (err instanceof CustomError) throw err
    logger[failureLogLevel]('Run-mode monitors fetch errored', {
      event: 'internal_api.run_mode_monitors.fetch_errored',
      error: err instanceof Error ? err.message : err,
    })
    throw unreachable(describeFetchError(err))
  }
}

// The error's cause says why work-center could not answer: the HTTP status or the fetch error
function unreachable(cause: string): CustomError {
  const err = new CustomError(503, 'error.work_center_unreachable')
  err.cause = cause
  return err
}

// A failed fetch says only "fetch failed"; the reason, such as a refused connection, is its cause
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message
}
