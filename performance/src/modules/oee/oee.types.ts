export type OeeRange = { from: Date; to: Date }

export type JobWindow = {
  jobOrderId: string
  productId: string
  workCenterId: string
  start: Date
  end: Date
}

export type StopSource = 'planned' | 'unplanned'

export type StopInterval = {
  _id: string
  workCenterId: string
  reasonId: string | null
  source: StopSource
  start: Date
  end: Date
  linkedPlannedStopId?: string | null
}

export type NormalizedStop = StopInterval & {
  effectiveAffectsOee: boolean
  isMicroStop: false
}
