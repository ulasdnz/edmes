/**
 * OpenAPI Setup — thin wrapper over @mes/openapi.
 *
 * Provides the Work Center Service-specific title and description
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
    title: 'Work Center Service API',
    description:
      'Work Center microservice — Work center management, schedules, operator check-in, action state.',
    paths,
  })
