import type { Router } from 'express'
import { describe, expect, it } from 'vitest'
import roleRoutes from '../../modules/role/role.routes.js'
import specialityRoutes from '../../modules/speciality/speciality.routes.js'
import authRoutes from '../../modules/user/auth.routes.js'
import userRoutes from '../../modules/user/user.routes.js'
import { openApiDocument } from './document.js'

type Schema = { properties: Record<string, Schema> }
type Operation = {
  responses: Record<string, { content: Record<string, { schema: Schema }> }>
}
type Doc = { paths: Record<string, Record<string, Operation>> }

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

  // scenario: OpenApiDocument.userService / constraints / /users/me meta.permissions
  it('documents meta.permissions on the /users/me response', () => {
    const doc = openApiDocument as unknown as Doc
    const schema = doc.paths['/users/me'].get.responses['200'].content['application/json'].schema
    expect(schema.properties.meta.properties).toHaveProperty('permissions')
  })

  // scenario: OpenApiDocument.userService / constraints / login user without lockout counters
  it('documents the login user without the lockout counters', () => {
    const doc = openApiDocument as unknown as Doc
    const user =
      doc.paths['/auth/login'].post.responses['200'].content['application/json'].schema.properties
        .data.properties.user
    expect(Object.keys(user.properties).length).toBeGreaterThan(0)
    expect(user.properties).not.toHaveProperty('failedLoginAttempts')
    expect(user.properties).not.toHaveProperty('lastFailedLoginAt')
  })
})
