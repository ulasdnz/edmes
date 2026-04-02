import {
  generateOpenApiDocument as generate,
  securityComponent,
  securityRequirement,
} from '@mes/openapi'
import type { ZodOpenApiPathsObject } from 'zod-openapi'

export { securityRequirement, securityComponent }

export const generateOpenApiDocument = (paths: ZodOpenApiPathsObject) =>
  generate({
    title: 'Telemetry Service API',
    description:
      'Telemetry microservice — MQTT ingestion, historian storage, tag-based calculations, EdgeDevice management.',
    paths,
  })
