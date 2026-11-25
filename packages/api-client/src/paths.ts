import type { paths as ProductionPaths } from './generated/production'
import type { paths as UserPaths } from './generated/user'
import type { paths as WorkCenterPaths } from './generated/work-center'

export type paths = UserPaths & WorkCenterPaths & ProductionPaths
