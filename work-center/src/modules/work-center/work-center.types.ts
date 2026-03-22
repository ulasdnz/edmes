import type { IWorkCenter } from './work-center.model.js'

export type WorkCenterResponse = Omit<IWorkCenter, 'password'>

export type WorkCenterType = 'physical' | 'virtual'
export type WorkCenterStatus = 'active' | 'archived'
export type ProductivityMode = 'count_based' | 'speed_based'
export type CompositionRule = 'primary_work_center' | 'average' | 'weighted'
