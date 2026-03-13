/**
 * OpenAPI Setup — thin wrapper over @mes/openapi.
 *
 * Provides the User Service-specific title and description
 * while using the shared document generator and security schemes.
 */

import {
  generateOpenApiDocument as generate,
  securityComponent,
  securityRequirement,
} from '@mes/openapi'
import type { ZodOpenApiPathsObject } from 'zod-openapi'

export { securityRequirement, securityComponent }

export const generateOpenApiDocument = (paths: ZodOpenApiPathsObject) =>
  generate({
    title: 'User Service API',
    description:
      'User microservice — Authentication, user management, roles, specialities, password policies.',
    paths,
  })
