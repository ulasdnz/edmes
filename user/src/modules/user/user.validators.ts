import { z } from 'zod'
import 'zod-openapi'
import { paginationSchema } from '../../utils/pagination.js'
import { objectIdSchema } from '../../utils/validators.js'

const emailSchema = z.email({ message: 'validation.email_invalid' }).meta({
  example: 'john.doe@example.com',
  description: 'User email address',
})

const nameSchema = z
  .string({ message: 'validation.name_required' })
  .trim()
  .min(2, { message: 'validation.name_min' })
  .max(24, { message: 'validation.name_max' })
  .meta({ example: 'John', description: 'First name' })

const surnameSchema = z
  .string({ message: 'validation.surname_required' })
  .trim()
  .min(1, { message: 'validation.surname_required' })
  .meta({ example: 'Doe', description: 'Last name' })

const usernameSchema = z
  .string({ message: 'validation.username_required' })
  .trim()
  .toLowerCase()
  .min(3, { message: 'validation.username_min' })
  .max(30, { message: 'validation.username_max' })
  .regex(/^[a-z0-9._-]+$/, { message: 'validation.username_format' })
  .meta({ example: 'johndoe', description: 'Unique username' })

const passwordPolicySchema = z
  .string({ message: 'validation.password_required' })
  .min(8, { message: 'validation.password_policy_min' })
  .max(20, { message: 'validation.password_policy_max' })
  .meta({ example: 'SecureP@ss123', description: 'User account password' })

const passwordInputSchema = z
  .string({ message: 'validation.password_required' })
  .min(1, { message: 'validation.password_required' })

const objectIdArraySchema = z.array(objectIdSchema).default([])

const propsSchema = z.record(z.string(), z.string()).optional()

export const registerSchema = z
  .object({
    username: usernameSchema,
    name: nameSchema,
    surname: surnameSchema,
    email: emailSchema,
    password: passwordPolicySchema,
  })
  .strict()

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordInputSchema,
}).strict()

export const updateMeSchema = z
  .object({
    name: nameSchema.optional(),
    surname: surnameSchema.optional(),
    email: emailSchema.optional(),
    username: usernameSchema.optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    countryCode: z.string().optional(),
    birthDate: z.coerce.date().optional(),
    language: z.enum(['en', 'tr']).optional(),
    defaultDashboardId: objectIdSchema.nullable().optional(),
  })
  .strict()

export const adminUpdateUserSchema = updateMeSchema
  .extend({
    personalNumber: z.string().nullable().optional(),
    isActiveDirectoryUser: z.boolean().optional(),
    isActivated: z.boolean().optional(),
    departmentId: objectIdSchema.nullable().optional(),
    workCenterIds: objectIdArraySchema.optional(),
    specialities: objectIdArraySchema.optional(),
    roles: z.array(objectIdSchema).optional(),
    props: propsSchema,
  })
  .strict()

export const adminCreateUserSchema = registerSchema.extend(adminUpdateUserSchema.shape).strict()

export const adminResetPasswordSchema = z
  .object({
    password: passwordPolicySchema,
  })
  .strict()

export const userListSchema = paginationSchema.extend({
  isActivated: z
    .enum(['true', 'false'])
    .transform(v => v === 'true')
    .optional(),
  departmentId: objectIdSchema.optional(),
  roles: objectIdSchema.optional(),
  populate: z.string().optional(),
})

export const userIdParamSchema = z.object({
  id: objectIdSchema,
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type UpdateMeInput = z.infer<typeof updateMeSchema>
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>
export type UserListInput = z.infer<typeof userListSchema>
