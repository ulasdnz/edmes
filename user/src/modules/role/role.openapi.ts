/**
 * Role OpenAPI path registrations.
 */

import type { ZodOpenApiPathsObject } from 'zod-openapi'
import { securityRequirement } from '../../lib/openapi/setup.js'
import { createRoleSchema, roleIdParamSchema, updateRoleSchema } from './role.validators.js'

export const rolePaths: ZodOpenApiPathsObject = {
  '/roles': {
    get: {
      tags: ['Roles'],
      security: securityRequirement,
      summary: 'List all roles (requires readRoles permission)',
      responses: {
        '200': { description: 'Array of roles' },
        '403': { description: 'Forbidden' },
      },
    },
    post: {
      tags: ['Roles'],
      security: securityRequirement,
      summary: 'Create a new role (requires createRoles permission)',
      requestBody: {
        content: { 'application/json': { schema: createRoleSchema } },
      },
      responses: {
        '201': { description: 'Role created' },
        '400': { description: 'Validation error' },
        '409': { description: 'Role name already exists' },
      },
    },
  },
  '/roles/{id}': {
    get: {
      tags: ['Roles'],
      security: securityRequirement,
      summary: 'Get role by ID',
      requestParams: { path: roleIdParamSchema },
      responses: {
        '200': { description: 'Role data' },
        '404': { description: 'Role not found' },
      },
    },
    patch: {
      tags: ['Roles'],
      security: securityRequirement,
      summary: 'Update role (requires writeRoles permission)',
      requestParams: { path: roleIdParamSchema },
      requestBody: {
        content: { 'application/json': { schema: updateRoleSchema } },
      },
      responses: {
        '200': { description: 'Role updated' },
        '404': { description: 'Role not found' },
      },
    },
    delete: {
      tags: ['Roles'],
      security: securityRequirement,
      summary: 'Delete role (requires deleteRoles permission)',
      requestParams: { path: roleIdParamSchema },
      responses: {
        '200': { description: 'Role deleted' },
        '404': { description: 'Role not found' },
      },
    },
  },
  '/roles/privileges': {
    get: {
      tags: ['Roles'],
      security: securityRequirement,
      summary: 'List all available privilege definitions (requires readRoles permission)',
      responses: {
        '200': { description: 'Array of privilege definitions' },
      },
    },
  },
}
