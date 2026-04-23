import { getTraceId } from '@mes/core'
import { config } from '../../config/index.js'
import { logger } from '../logger.js'

export interface RunModeMonitor {
  workCenterId: string
  runModeTagId: string
}

export async function listRunModeMonitors(): Promise<RunModeMonitor[]> {
  try {
    const res = await fetch(
      `${config.INTERNAL_API_WORK_CENTER}/internal/v1/work-centers/run-mode-monitors`,
      {
        method: 'GET',
        headers: {
          'x-trace-id': getTraceId() ?? '',
          accept: 'application/json',
        },
      },
    )
    if (!res.ok) {
      logger.warn('Run-mode monitors fetch failed', {
        event: 'internal_api.run_mode_monitors.fetch_failed',
        status: res.status,
      })
      return []
    }
    const body = (await res.json()) as { data?: RunModeMonitor[] }
    return body.data ?? []
  } catch (err) {
    logger.warn('Run-mode monitors fetch errored', {
      event: 'internal_api.run_mode_monitors.fetch_errored',
      error: err instanceof Error ? err.message : err,
    })
    return []
  }
}
