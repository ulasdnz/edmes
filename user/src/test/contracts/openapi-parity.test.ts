import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { passwordRecoveryPaths } from '../../modules/password-recovery/password-recovery.openapi.js'
import { rolePaths } from '../../modules/role/role.openapi.js'
import { specialityPaths } from '../../modules/speciality/speciality.openapi.js'
import { userPaths } from '../../modules/user/user.openapi.js'

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']

const ROUTE_FILES = [
  'src/modules/user/auth.routes.ts',
  'src/modules/user/user.routes.ts',
  'src/modules/role/role.routes.ts',
  'src/modules/speciality/speciality.routes.ts',
  'src/modules/password-recovery/password-recovery.routes.ts',
]

const combinedOpenApiPaths = {
  ...userPaths,
  ...rolePaths,
  ...specialityPaths,
  ...passwordRecoveryPaths,
}

const normalizeToOpenApiPath = (routePath: string): string =>
  routePath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}')

const extractRoutesFromFile = (content: string): string[] => {
  const routes: string[] = []
  const routeRegex = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g

  for (const match of content.matchAll(routeRegex)) {
    const method = match[1]?.toLowerCase()
    const routePath = match[2]
    if (!method || !routePath) continue

    routes.push(`${method.toUpperCase()} ${normalizeToOpenApiPath(routePath)}`)
  }

  return routes
}

const collectRouteSignatures = (): Set<string> => {
  const signatures = new Set<string>()

  for (const routeFile of ROUTE_FILES) {
    const fullPath = path.resolve(process.cwd(), routeFile)
    const content = fs.readFileSync(fullPath, 'utf8')

    for (const signature of extractRoutesFromFile(content)) {
      signatures.add(signature)
    }
  }

  return signatures
}

const collectOpenApiSignatures = (): Set<string> => {
  const signatures = new Set<string>()

  for (const [openApiPath, operations] of Object.entries(combinedOpenApiPaths)) {
    for (const method of HTTP_METHODS) {
      if (operations?.[method]) {
        signatures.add(`${method.toUpperCase()} ${openApiPath}`)
      }
    }
  }

  return signatures
}

describe('OpenAPI route parity', () => {
  it('contains all implemented routes in OpenAPI', () => {
    const routeSignatures = collectRouteSignatures()
    const openApiSignatures = collectOpenApiSignatures()

    const missingInOpenApi = [...routeSignatures].filter(sig => !openApiSignatures.has(sig))
    expect(missingInOpenApi).toEqual([])
  })

  it('does not expose undocumented endpoints in OpenAPI', () => {
    const routeSignatures = collectRouteSignatures()
    const openApiSignatures = collectOpenApiSignatures()

    const extraInOpenApi = [...openApiSignatures].filter(sig => !routeSignatures.has(sig))
    expect(extraInOpenApi).toEqual([])
  })
})

