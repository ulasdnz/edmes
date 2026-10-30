// Samples at or before this instant are rejected. A period-close event from production is meant
// to set it; no service publishes one yet, so telemetry subscribes to no stream.
let periodLockBefore: Date | null = null

export const getPeriodLock = () => periodLockBefore

export const setPeriodLock = (date: Date | null) => {
  periodLockBefore = date
}
