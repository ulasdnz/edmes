import type { ZodOpenApiPathsObject } from 'zod-openapi'
import {
  requestCodeSchema,
  verificationAndUpdateSchema,
  verificationCodeSchema,
} from './password-recovery.validators.js'

export const passwordRecoveryPaths: ZodOpenApiPathsObject = {
  '/password-recoveries': {
    post: {
      tags: ['Auth'],
      summary: 'Request a password recovery PIN code',
      requestBody: {
        content: {
          'application/json': {
            schema: requestCodeSchema,
          },
        },
      },
      responses: {
        '200': { description: 'Request accepted (uniform response to prevent user enumeration)' },
        '400': { description: 'Validation error' },
      },
    },
  },
  '/password-recoveries/verification': {
    post: {
      tags: ['Auth'],
      summary: 'Verify a password recovery PIN code',
      requestBody: {
        content: {
          'application/json': {
            schema: verificationCodeSchema,
          },
        },
      },
      responses: {
        '200': { description: 'PIN verified successfully' },
        '400': { description: 'Invalid/expired code or validation error' },
      },
    },
  },
  '/password-recoveries/verification-and-update': {
    post: {
      tags: ['Auth'],
      summary: 'Verify a password recovery PIN code and reset password',
      requestBody: {
        content: {
          'application/json': {
            schema: verificationAndUpdateSchema,
          },
        },
      },
      responses: {
        '200': { description: 'Password reset successfully' },
        '400': { description: 'Invalid code, password policy violation, or validation error' },
      },
    },
  },
}
