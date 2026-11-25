export type JobOrderRuntimeState = 'pending' | 'running' | 'finished'

export function jobOrderRuntimeState(jobOrder: {
  startTime?: string | null
  endTime?: string | null
}): JobOrderRuntimeState {
  if (!jobOrder.startTime) return 'pending'
  return jobOrder.endTime ? 'finished' : 'running'
}
