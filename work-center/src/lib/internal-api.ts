import { config } from '../config/index.js'
import { logger } from './logger.js'

const USER_API = config.INTERNAL_API_USER

async function fetchInternal(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${USER_API}/internal/v1${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
}

/**
 * Best-effort: add work center to creator's workCenterIds via user-service.
 * Fire-and-forget — never throws.
 *
 * Uses GET /users/:id → PATCH /users/:id (merge into existing array).
 */
export async function addWorkCenterToUser(userId: string, workCenterId: string): Promise<void> {
  try {
    // 1. Fetch current user to get existing workCenterIds
    const getRes = await fetchInternal(`/users/${userId}`)
    if (!getRes.ok) {
      logger.warn('User-service visibility: user fetch failed', {
        event: 'internal_api.user.visibility_fetch_failed',
        userId,
        workCenterId,
        status: getRes.status,
      })
      return
    }
    const getBody = (await getRes.json()) as { data?: { workCenterIds?: string[] } }
    const existing = getBody.data?.workCenterIds?.map(String) ?? []

    // Already has this WC — skip
    if (existing.includes(workCenterId)) return

    // 2. PATCH with merged array
    const merged = [...existing, workCenterId]
    const patchRes = await fetchInternal(`/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ workCenterIds: merged }),
    })
    if (!patchRes.ok) {
      logger.warn('User-service rejected visibility update', {
        event: 'internal_api.user.visibility_rejected',
        userId,
        workCenterId,
        status: patchRes.status,
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
 * Uses GET /users/check-dependencies?fieldName=workCenterIds&fieldValue={id}.
 * Fails closed (returns true) if user-service is unreachable — blocks delete.
 */
export async function isWorkCenterReferencedByUsers(workCenterId: string): Promise<boolean> {
  try {
    const res = await fetchInternal(
      `/users/check-dependencies?fieldName=workCenterIds&fieldValue=${workCenterId}`,
    )
    if (!res.ok) {
      logger.warn('User-service reference check failed, blocking delete', {
        event: 'internal_api.user.reference_check_failed',
        workCenterId,
        status: res.status,
      })
      return true
    }
    const body = (await res.json()) as { data?: { inUse?: boolean } }
    return body.data?.inUse ?? true
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
  } catch (err) {
    logger.warn('Cannot reach user-service for operator validation', {
      event: 'internal_api.user.operator_validation_unreachable',
      operatorId,
      error: err instanceof Error ? err.message : err,
    })
    return false
  }
}

const PRODUCTION_API = config.INTERNAL_API_PRODUCTION

async function fetchProduction(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${PRODUCTION_API}/internal/v1${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
}

export async function hasProductionShiftReferences(shiftId: string): Promise<boolean> {
  try {
    const res = await fetchProduction(`/shifts/${shiftId}/references`)
    if (!res.ok) {
      logger.warn('Production-service shift reference check failed, blocking delete', {
        event: 'internal_api.production.shift_ref_check_failed',
        shiftId,
        status: res.status,
      })
      return true
    }
    const body = (await res.json()) as { data?: { inUse?: boolean } }
    return body.data?.inUse ?? true
  } catch (err) {
    logger.warn('Cannot reach production-service for shift reference check, blocking delete', {
      event: 'internal_api.production.shift_ref_check_unreachable',
      shiftId,
      error: err instanceof Error ? err.message : err,
    })
    return true
  }
}
