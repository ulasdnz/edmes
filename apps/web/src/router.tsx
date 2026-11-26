import type { AppCore } from '@mes/frontend/core'
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function createAppRouter(core: AppCore) {
  return createRouter({ routeTree, context: { core }, scrollRestoration: true })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
