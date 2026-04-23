/**
 * OpenAPI Setup — thin wrapper over @mes/openapi.
 *
 * Provides the Performance Service-specific title and description
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
    title: 'Performance Service API',
    description:
      'Performance microservice — OEE, planned/unplanned stops, reasons and performance policy.',
    paths,
  })
