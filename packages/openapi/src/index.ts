/**
 * OpenAPI Setup
 *
 * Central registry and document generator using zod-openapi.
 * Each service calls generateOpenApiDocument({ title, description, paths })
 * to produce its unique spec.
 *
 * The generated OpenAPI 3.1.0 spec is served at /docs in non-production environments.
 */

import type { ZodOpenApiComponentsObject, ZodOpenApiPathsObject } from 'zod-openapi'
import { createDocument } from 'zod-openapi'

// ── Shared security scheme ──────────────────────────────────────────────────

export const securityRequirement = [{ BearerAuth: [] }]

export const securityComponent: ZodOpenApiComponentsObject = {
  securitySchemes: {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT authentication token',
    },
  },
}

// ── Document generator ──────────────────────────────────────────────────────

export interface OpenApiDocOptions {
  title: string
  description: string
  version?: string
  paths: ZodOpenApiPathsObject
}

export const generateOpenApiDocument = ({
  title,
  description,
  version = '1.0.0',
  paths,
}: OpenApiDocOptions): object => {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title,
      version,
      description,
    },
    servers: [
      { url: '/api/v1', description: 'Public / Protected API' },
      { url: '/internal/v1', description: 'Internal (inter-service)' },
    ],
    components: securityComponent,
    security: securityRequirement,
    paths,
  })
}
