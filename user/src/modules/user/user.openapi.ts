import { z } from 'zod'
import type { ZodOpenApiPathsObject } from 'zod-openapi'
import { securityRequirement } from '../../lib/openapi/setup.js'
import {
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  loginSchema,
  registerSchema,
  updateMeSchema,
  userIdParamSchema,
  userListSchema,
} from './user.validators.js'

export const userPaths: ZodOpenApiPathsObject = {
  // ── Auth (public, no auth) ──────────────────────────────────────────────────
  '/auth/register': {
    post: {
      tags: ['Auth'],
      security: [],
      summary: 'Register a new user',
      requestBody: {
        content: { 'application/json': { schema: registerSchema } },
      },
      responses: {
        '201': { description: 'User registered successfully' },
        '400': { description: 'Validation error' },
        '409': { description: 'User already exists' },
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      security: [],
      summary: 'Login with email and password',
      requestBody: {
        content: { 'application/json': { schema: loginSchema } },
      },
      responses: {
        '200': { description: 'Login successful, returns JWT token' },
        '401': { description: 'Invalid credentials' },
      },
    },
  },

  // ── Users (protected) ───────────────────────────────────────────────────────
  '/users/me': {
    get: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Get current authenticated user profile',
      responses: {
        '200': { description: 'User profile data' },
        '401': { description: 'Unauthorized' },
      },
    },
    patch: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Update current user profile',
      requestBody: {
        content: { 'application/json': { schema: updateMeSchema } },
      },
      responses: {
        '200': { description: 'User updated successfully' },
        '400': { description: 'Validation error' },
      },
    },
    delete: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Delete current user account',
      responses: {
        '200': { description: 'User deleted successfully' },
        '401': { description: 'Unauthorized' },
      },
    },
  },
  '/users': {
    get: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'List users with pagination, search, and filtering',
      requestParams: { query: userListSchema },
      responses: {
        '200': { description: 'Paginated list of users' },
        '400': { description: 'Invalid query parameters' },
        '403': { description: 'Forbidden — missing readUsers permission' },
      },
    },
    post: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Create a new user (admin only)',
      requestBody: {
        content: { 'application/json': { schema: adminCreateUserSchema } },
      },
      responses: {
        '201': { description: 'User created successfully' },
        '400': { description: 'Validation error' },
        '403': { description: 'Forbidden' },
        '409': { description: 'User already exists' },
      },
    },
  },
  '/users/{id}': {
    get: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Get user by ID (requires readUsers permission)',
      requestParams: { path: userIdParamSchema },
      responses: {
        '200': { description: 'User data' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
    patch: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Update any user (admin only)',
      requestParams: { path: userIdParamSchema },
      requestBody: {
        content: { 'application/json': { schema: adminUpdateUserSchema } },
      },
      responses: {
        '200': { description: 'User updated successfully' },
        '400': { description: 'Validation error' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
    delete: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Delete any user (admin only)',
      requestParams: { path: userIdParamSchema },
      responses: {
        '200': { description: 'User deleted successfully' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
  },
  '/users/{id}/reset-password': {
    post: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Reset user password (admin only)',
      requestParams: { path: userIdParamSchema },
      requestBody: {
        content: { 'application/json': { schema: adminResetPasswordSchema } },
      },
      responses: {
        '200': { description: 'Password reset successfully' },
        '400': { description: 'Validation error or policy violation' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
  },
  '/users/me/avatar': {
    patch: {
      tags: ['Users'],
      security: securityRequirement,
      summary: 'Upload/update user avatar',
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: { photo: { type: 'string', format: 'binary' } },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Avatar updated' },
      },
    },
  },

  // ── Lookups & Helpers ───────────────────────────────────────────────────────
  '/user-by-username/{username}': {
    get: {
      tags: ['Users', 'Lookups'],
      security: securityRequirement,
      summary: 'Get user by username (requires readUsers permission)',
      requestParams: { path: z.object({ username: z.string() }) },
      responses: {
        '200': { description: 'User data' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
  },
  '/user-by-email/{email}': {
    get: {
      tags: ['Users', 'Lookups'],
      security: securityRequirement,
      summary: 'Get user by email (requires readUsers permission)',
      requestParams: { path: z.object({ email: z.string().email() }) },
      responses: {
        '200': { description: 'User data' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
  },
  '/user-with-roles/{id}': {
    get: {
      tags: ['Users', 'Lookups'],
      security: securityRequirement,
      summary: 'Get user by ID with populated roles (requires readUsers permission)',
      requestParams: { path: userIdParamSchema },
      responses: {
        '200': { description: 'User data with populated roles' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
  },
  '/users/{id}/roles-permissions': {
    get: {
      tags: ['Users', 'Lookups', 'Sync'],
      security: securityRequirement,
      summary: 'Get user roles and permissions array (Internal cross-service sync fallback)',
      requestParams: { path: userIdParamSchema },
      responses: {
        '200': { description: 'User roles and permissions strings' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
  },
  '/users/{id}/auth-status': {
    get: {
      tags: ['Users', 'Lookups', 'Sync'],
      security: securityRequirement,
      summary: 'Get user activation and password-change status (auth middleware fallback)',
      requestParams: { path: userIdParamSchema },
      responses: {
        '200': { description: 'User auth status' },
        '403': { description: 'Forbidden' },
        '404': { description: 'User not found' },
      },
    },
  },
  '/users-languages': {
    get: {
      tags: ['Users', 'Lookups'],
      security: securityRequirement,
      summary: 'Get list of supported languages (requires readUsers permission)',
      responses: {
        '200': { description: 'Array of language codes' },
        '403': { description: 'Forbidden' },
      },
    },
  },
  '/users/props-keys': {
    get: {
      tags: ['Users', 'Lookups'],
      security: securityRequirement,
      summary:
        'Get list of distinct dynamic property keys used by all users (requires readUsers permission)',
      responses: {
        '200': { description: 'Array of property keys' },
        '403': { description: 'Forbidden' },
      },
    },
  },

  // ── System Sync ─────────────────────────────────────────────────────────────
  '/users/check-dependencies': {
    get: {
      tags: ['Users', 'Sync'],
      security: securityRequirement,
      summary:
        'Check if a specific dependency (e.g., departmentId, stationIds) is in use by any user',
      requestParams: {
        query: z.object({
          fieldName: z.enum(['departmentId', 'stationIds']),
          fieldValue: z.string(),
        }),
      },
      responses: {
        '200': { description: 'Returns boolean indicating usage' },
        '400': { description: 'Validation error' },
        '403': { description: 'Forbidden' },
      },
    },
  },
}
