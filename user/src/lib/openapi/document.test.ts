import type { Router } from 'express'
import { describe, expect, it } from 'vitest'
import roleRoutes from '../../modules/role/role.routes.js'
import specialityRoutes from '../../modules/speciality/speciality.routes.js'
import authRoutes from '../../modules/user/auth.routes.js'
import userRoutes from '../../modules/user/user.routes.js'
import { openApiDocument } from './document.js'

const mountedRoutes = (router: Router) =>
  router.stack.flatMap(layer => {
    const route = (layer as { route?: { path: string; methods: Record<string, boolean> } }).route
    if (!route) return []
    const path = route.path.replace(/:(\w+)/g, '{$1}')
    return Object.keys(route.methods).map(method => `${method.toUpperCase()} ${path}`)
  })

describe('user service openapi document', () => {
  it('documents every public route', () => {
    const mounted = [authRoutes, userRoutes, roleRoutes, specialityRoutes].flatMap(mountedRoutes)
    const documented = Object.entries(
      (openApiDocument as { paths: Record<string, object> }).paths,
    ).flatMap(([path, item]) => Object.keys(item).map(method => `${method.toUpperCase()} ${path}`))

    expect(mounted.length).toBeGreaterThan(0)
    expect(mounted.filter(route => !documented.includes(route))).toEqual([])
  })
})
