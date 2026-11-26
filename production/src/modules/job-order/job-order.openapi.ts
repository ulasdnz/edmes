/**
 * Job order OpenAPI path registrations (read routes).
 */

import { paginationMetaSchema } from '@mes/core/pagination'
import { z } from 'zod'
import type { ZodOpenApiPathsObject } from 'zod-openapi'
import { securityRequirement } from '../../lib/openapi/setup.js'
import { jobOrderIdParamSchema, jobOrderListSchema } from './job-order.validators.js'

const jobOrderResponseSchema = z.object({
  _id: z.string(),
  code: z.string(),
  productId: z.string(),
  workCenterId: z.string(),
  productionPlanId: z.string().nullable(),
  targetQuantity: z.number(),
  plannedStartAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  description: z.string().nullable(),
  props: z.record(z.string(), z.string()),
  createdBy: z.string(),
  updatedBy: z.string().nullable(),
  startedBy: z.string().nullable(),
  endedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const jobOrderPaths: ZodOpenApiPathsObject = {
  '/job-orders': {
    get: {
      tags: ['Job Orders'],
      security: securityRequirement,
      summary: 'List job orders within the caller work centers (requires readJobOrders)',
      requestParams: { query: jobOrderListSchema },
      responses: {
        '200': {
          description: 'Paginated list of job orders',
          content: {
            'application/json': {
              schema: z.object({
                data: z.array(jobOrderResponseSchema),
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
  '/job-orders/{id}': {
    get: {
      tags: ['Job Orders'],
      security: securityRequirement,
      summary: 'Get job order by ID (requires readJobOrders)',
      requestParams: { path: jobOrderIdParamSchema },
      responses: {
        '200': {
          description: 'Job order data',
          content: { 'application/json': { schema: z.object({ data: jobOrderResponseSchema }) } },
        },
        '403': { description: 'Forbidden' },
        '404': { description: 'Job order not found' },
      },
    },
  },
}
