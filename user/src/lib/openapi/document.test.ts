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

  // scenario: OpenApiDocument.plantTime / constraints / GET /auth/plant-time public with its schema
  it('documents GET /auth/plant-time as public with plantTimezone and serverTime', () => {
    type Prop = { type?: string; properties: Record<string, Prop> }
    const doc = openApiDocument as unknown as {
      paths: Record<
        string,
        Record<
          string,
          {
            security?: unknown[]
            responses: Record<string, { content: Record<string, { schema: Prop }> }>
          }
        >
      >
    }
    const op = doc.paths['/auth/plant-time']?.get
    expect(op).toBeDefined()
    expect(op.security).toEqual([])
    const data = op.responses['200'].content['application/json'].schema.properties.data
    expect(Object.keys(data.properties).sort()).toEqual(['plantTimezone', 'serverTime'])
    expect(data.properties.plantTimezone.type).toBe('string')
    expect(data.properties.serverTime.type).toBe('string')
  })

  // scenario: OpenApiDocument.plantTime / constraints / /users get lists withoutWorkCenter
  it('lists the withoutWorkCenter query parameter on GET /users', () => {
    const doc = openApiDocument as unknown as {
      paths: Record<string, Record<string, { parameters?: { name: string; in: string }[] }>>
    }
    const params = doc.paths['/users'].get.parameters ?? []
    expect(params).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'withoutWorkCenter', in: 'query' })]),
    )
  })

  // scenario: OpenApiDocument.profile / constraints / avatar delete, populate, gender, no username
  it('documents the profile endpoints: avatar delete, populate, two genders, no username', () => {
    type Prop = { enum?: string[]; properties?: Record<string, Prop> }
    type Op = {
      parameters?: { name: string; in: string; schema?: Prop }[]
      requestBody?: { content: Record<string, { schema: Prop }> }
      responses: Record<string, { content?: Record<string, { schema: Prop }> }>
    }
    const doc = openApiDocument as unknown as { paths: Record<string, Record<string, Op>> }

    expect(doc.paths['/users/me/avatar'].delete).toBeDefined()

    const populate = (doc.paths['/users/me'].get.parameters ?? []).find(
      param => param.name === 'populate' && param.in === 'query',
    )
    expect(populate?.schema?.enum).toEqual(['roles'])

    const patchBody =
      doc.paths['/users/me'].patch.requestBody?.content['application/json'].schema.properties
    expect(patchBody).toBeDefined()
    expect(patchBody).not.toHaveProperty('username')
    expect(patchBody?.gender.enum).toEqual(['male', 'female'])

    const adminBody =
      doc.paths['/users/{id}'].patch.requestBody?.content['application/json'].schema.properties
    expect(adminBody).toHaveProperty('username')
    expect(adminBody?.gender.enum).toEqual(['male', 'female'])

    const user =
      doc.paths['/users/me'].get.responses['200'].content?.['application/json'].schema.properties
        ?.data
    expect(user?.properties?.gender.enum).toEqual(['male', 'female'])
  })
})
