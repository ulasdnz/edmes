import type { Router } from 'express'
import { describe, expect, it } from 'vitest'
import historianInternalRoutes from './historian.internal.routes.js'
import historianRoutes from './historian.routes.js'

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> }
}

const collectPaths = (router: Router): string[] => {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack
  return stack
    .filter(layer => layer.route)
    .map(layer => {
      const route = layer.route as NonNullable<RouteLayer['route']>
      const method = Object.keys(route.methods)[0].toUpperCase()
      return `${method} ${route.path}`
    })
}

describe('historian route registration', () => {
  it('internal router exposes /:tagId/latest and /:tagId/state-durations', () => {
    const paths = collectPaths(historianInternalRoutes)
    expect(paths).toContain('GET /historian/:tagId/latest')
    expect(paths).toContain('GET /historian/:tagId/state-durations')
  })

  it('public router no longer exposes /:tagId/latest or /:tagId/state-durations', () => {
    const paths = collectPaths(historianRoutes)
    expect(paths).not.toContain('GET /historian/:tagId/latest')
    expect(paths).not.toContain('GET /historian/:tagId/state-durations')
  })
})
