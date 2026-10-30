import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { config } from '../config/index.js'
import { logger } from './logger.js'

const USER_API = config.INTERNAL_API_USER

async function fetchInternal(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${USER_API}/internal/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
      [INTERNAL_TOKEN_HEADER]: config.INTERNAL_API_TOKEN,
    },
  })
}

/**
 * Best-effort: add work center to creator's workCenterIds via user-service. Never throws.
 *
 * user-service adds it atomically, so work centers created at the same time all reach the list.
 */
export async function addWorkCenterToUser(userId: string, workCenterId: string): Promise<void> {
  try {
    const res = await fetchInternal(`/users/${userId}/work-center-ids`, {
      method: 'POST',
      body: JSON.stringify({ workCenterId }),
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
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
      [INTERNAL_TOKEN_HEADER]: config.INTERNAL_API_TOKEN,
    },
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
