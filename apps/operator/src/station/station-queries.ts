import type { ApiClient } from '@mes/api-client'
import { runningJobOrderOptions } from '@mes/frontend/data/production/job-orders'
import { workCentersListOptions } from '@mes/frontend/data/work-center/work-centers'
import { recoverWhileUnavailable } from '../recovery'

// The queries of the picker and the station screen, with the panel's recovery rule.

export function visibleWorkCentersQuery(api: ApiClient, recoveryMs?: number) {
  return {
    ...workCentersListOptions(api, { status: 'active' }),
    ...recoverWhileUnavailable(recoveryMs),
  }
}

export function stationJobOrderQuery(api: ApiClient, workCenterId: string, recoveryMs?: number) {
  return {
    ...runningJobOrderOptions(api, workCenterId),
    ...recoverWhileUnavailable(recoveryMs),
  }
}
