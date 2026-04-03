import { config } from '../config/index.js'
import { logger } from './logger.js'

const WC_API = config.INTERNAL_API_WORK_CENTER

async function fetchInternal(
  baseUrl: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl}/internal/v1${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
}

// ── Work center service calls ───────────────────────────────────────────────

interface WorkCenterInfo {
  type: 'physical' | 'virtual'
  productivityMode?: 'count_based' | 'speed_based'
}

export async function getWorkCenterInfo(workCenterId: string): Promise<WorkCenterInfo | null> {
  try {
    const res = await fetchInternal(WC_API, `/work-centers/${workCenterId}`)
    if (!res.ok) return null
    const body = (await res.json()) as { data?: WorkCenterInfo }
    return body.data ?? null
  } catch {
    logger.warn('Work-center-service unreachable', {
      event: 'internal_api.work_center.unreachable',
      workCenterId,
    })
    return null
  }
}
