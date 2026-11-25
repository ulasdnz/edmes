import type { AppCore } from '@mes/frontend/core'
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import type { StationStore } from './station/station-store'

export function createAppRouter(core: AppCore, station: StationStore) {
  return createRouter({ routeTree, context: { core, station }, basepath: '/operator' })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
