/**
 * Speciality OpenAPI path registrations.
 */

import type { ZodOpenApiPathsObject } from 'zod-openapi'
import { securityRequirement } from '../../lib/openapi/setup.js'
import {
  createSpecialitySchema,
  specialityIdParamSchema,
  updateSpecialitySchema,
} from './speciality.validators.js'

export const specialityPaths: ZodOpenApiPathsObject = {
  '/specialities': {
    get: {
      tags: ['Specialities'],
      security: securityRequirement,
      summary: 'List all specialities (requires readSpecialities permission)',
      responses: {
        '200': { description: 'Array of specialities' },
        '403': { description: 'Forbidden' },
      },
    },
    post: {
      tags: ['Specialities'],
      security: securityRequirement,
      summary: 'Create a new speciality (requires createSpecialities permission)',
      requestBody: {
        content: { 'application/json': { schema: createSpecialitySchema } },
      },
      responses: {
        '201': { description: 'Speciality created' },
        '400': { description: 'Validation error' },
      },
    },
  },
  '/specialities/{id}': {
    get: {
      tags: ['Specialities'],
      security: securityRequirement,
      summary: 'Get speciality by ID',
      requestParams: { path: specialityIdParamSchema },
      responses: {
        '200': { description: 'Speciality data' },
        '404': { description: 'Speciality not found' },
      },
    },
    patch: {
      tags: ['Specialities'],
      security: securityRequirement,
      summary: 'Update speciality (requires writeSpecialities permission)',
      requestParams: { path: specialityIdParamSchema },
      requestBody: {
        content: { 'application/json': { schema: updateSpecialitySchema } },
      },
      responses: {
        '200': { description: 'Speciality updated' },
        '404': { description: 'Speciality not found' },
      },
    },
    delete: {
      tags: ['Specialities'],
      security: securityRequirement,
      summary: 'Delete speciality (requires deleteSpecialities permission)',
      requestParams: { path: specialityIdParamSchema },
      responses: {
        '200': { description: 'Speciality deleted' },
        '404': { description: 'Speciality not found' },
      },
    },
  },
}
