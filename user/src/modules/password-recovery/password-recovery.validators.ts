import { z } from 'zod'
import 'zod-openapi'

export const requestCodeSchema = z.object({
  email: z.email({ message: 'user.invalid_email_format' }).meta({
    example: 'john.doe@example.com',
    description: 'User email to send recovery code',
  }),
}).strict()

export const verificationCodeSchema = z.object({
  email: z.email({ message: 'user.invalid_email_format' }).meta({
    example: 'john.doe@example.com',
  }),
  code: z
    .number()
    .int()
    .min(10000)
    .max(99999)
    .meta({ example: 12345, description: '5-digit verification code' }),
}).strict()

export const verificationAndUpdateSchema = z.object({
  email: z.email({ message: 'user.invalid_email_format' }).meta({
    example: 'john.doe@example.com',
  }),
  code: z.number().int().min(10000).max(99999).meta({ example: 12345 }),
  newPassword: z
    .string()
    .min(1, 'user.password_required')
    .meta({ example: 'NewSecureP@ss123!', description: 'New password for the account' }),
}).strict()

export type RequestCodeInput = z.infer<typeof requestCodeSchema>
export type VerificationCodeInput = z.infer<typeof verificationCodeSchema>
export type VerificationAndUpdateInput = z.infer<typeof verificationAndUpdateSchema>
