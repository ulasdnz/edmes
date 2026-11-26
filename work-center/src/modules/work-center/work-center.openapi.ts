/**
 * Work center OpenAPI path registrations (read routes).
 */

import { paginationMetaSchema } from '@mes/core/pagination'
import { z } from 'zod'
import type { ZodOpenApiPathsObject } from 'zod-openapi'
import { securityRequirement } from '../../lib/openapi/setup.js'
import { workCenterIdParamSchema, workCenterListSchema } from './work-center.validators.js'

const contributorResponseSchema = z.object({
  workCenterId: z.string(),
  weight: z.number().nullable(),
})

const compositionRuleResponseSchema = z.object({
  rule: z.enum(['primary_work_center', 'average', 'weighted']),
  contributors: z.array(contributorResponseSchema),
})

const workCenterResponseSchema = z.object({
  _id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(['physical', 'virtual']),
  status: z.enum(['active', 'archived']),
  parentWorkCenterId: z.string().nullable(),
  props: z.record(z.string(), z.string()),
  shiftIds: z.array(z.string()),
  productivityMode: z.enum(['count_based', 'speed_based']).nullable(),
  tagBindings: z
    .object({
      productionCounterTagId: z.string().nullable(),
      runModeTagId: z.string(),
      speedTagId: z.string().nullable(),
    })
    .nullable(),
  metricComposition: z
    .object({
      availability: compositionRuleResponseSchema,
      productivity: compositionRuleResponseSchema,
      quality: compositionRuleResponseSchema,
    })
    .nullable(),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const workCenterPaths: ZodOpenApiPathsObject = {
  '/work-centers': {
    get: {
      tags: ['Work Centers'],
      security: securityRequirement,
      summary: 'List work centers with pagination and filtering (requires readWorkCenters)',
      requestParams: { query: workCenterListSchema },
      responses: {
        '200': {
          description: 'Paginated list of work centers',
          content: {
            'application/json': {
              schema: z.object({
                data: z.array(workCenterResponseSchema),
                pagination: paginationMetaSchema,
              }),
            },
          },
        },
        '400': { description: 'Invalid query parameters' },
        '403': { description: 'Forbidden' },
      },
    },
  },
  '/work-centers/{id}': {
    get: {
      tags: ['Work Centers'],
      security: securityRequirement,
      summary: 'Get work center by ID (requires readWorkCenters)',
      requestParams: { path: workCenterIdParamSchema },
      responses: {
        '200': {
          description: 'Work center data',
          content: {
            'application/json': { schema: z.object({ data: workCenterResponseSchema }) },
          },
        },
        '403': { description: 'Forbidden' },
        '404': { description: 'Work center not found' },
      },
    },
  },
}
