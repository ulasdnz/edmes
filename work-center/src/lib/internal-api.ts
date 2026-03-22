import { config } from '../config/index.js'
import { logger } from './logger.js'

const USER_API = config.INTERNAL_API_USER

async function fetchInternal(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${USER_API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
}

/**
 * Best-effort: add work center to creator's workCenterIds via user-service.
 * Fire-and-forget — never throws.
 */
export async function addWorkCenterToUser(userId: string, workCenterId: string): Promise<void> {
  try {
    const res = await fetchInternal(`/users/${userId}/work-center-ids`, {
      method: 'PATCH',
      body: JSON.stringify({ add: [workCenterId] }),
    })
    if (!res.ok) {
      logger.warn('User-service rejected visibility update', {
        event: 'internal_api.user.visibility_rejected',
        userId,
        workCenterId,
        status: res.status,
      })
    }
  } catch (err) {
    logger.warn('Failed to reach user-service for visibility update', {
      event: 'internal_api.user.visibility_failed',
      userId,
      workCenterId,
      error: err instanceof Error ? err.message : err,
    })
  }
}

/**
 * Check if any user references this work center in their workCenterIds.
 * Fails closed (returns true) if user-service is unreachable — blocks delete.
 */
export async function isWorkCenterReferencedByUsers(workCenterId: string): Promise<boolean> {
  try {
    const res = await fetchInternal(`/users?workCenterIds=${workCenterId}&limit=1`)
    if (!res.ok) {
      logger.warn('User-service reference check failed, blocking delete', {
        event: 'internal_api.user.reference_check_failed',
        workCenterId,
        status: res.status,
      })
      return true
    }
    const body = (await res.json()) as { data?: { docs?: unknown[] } }
    return (body.data?.docs?.length ?? 0) > 0
  } catch (err) {
    logger.warn('Cannot reach user-service for reference check, blocking delete', {
      event: 'internal_api.user.reference_check_unreachable',
      workCenterId,
      error: err instanceof Error ? err.message : err,
    })
    return true
  }
}

/**
 * Validate that an operator (user) exists in user-service.
 * Returns false if user-service is unreachable.
 */
export async function validateOperatorExists(operatorId: string): Promise<boolean> {
  try {
    const res = await fetchInternal(`/users/${operatorId}`)
    return res.ok
  } catch {
    return false
  }
}
