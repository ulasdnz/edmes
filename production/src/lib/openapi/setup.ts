/**
 * OpenAPI Setup — thin wrapper over @mes/openapi.
 *
 * Provides the Production Service-specific title and description
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
    title: 'Production Service API',
    description:
      'Production microservice — UoM, products, standards, production plans, job orders, adjustments, scrap entries.',
    paths,
  })
