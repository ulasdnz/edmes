import { z } from 'zod'
import 'zod-openapi'
import { VALID_PRIVILEGE_CODES } from '../../constants/privileges.js'
import { objectIdSchema } from '../../utils/validators.js'

const nameSchema = z
  .string({ message: 'validation.role_name_required' })
  .trim()
  .min(2, { message: 'validation.role_name_min' })
  .max(50, { message: 'validation.role_name_max' })
  .meta({ example: 'Operator', description: 'Name of the security role' })

/**
 * Validates that each permission code exists in the privilege registry.
 */
const permissionCodeSchema = z
  .string()
  .trim()
  .refine(code => VALID_PRIVILEGE_CODES.has(code), {
    message: 'validation.invalid_permission_code',
  })

export const createRoleSchema = z
  .object({
    name: nameSchema,
    description: z
      .string()
      .optional()
      .meta({ example: 'Production line operator role', description: 'Description of the role' }),
    permissions: z
      .array(permissionCodeSchema)
      .min(1, { message: 'validation.permissions_required' })
      .meta({
        example: ['readUsers', 'writeWorkOrders'],
        description: 'List of privilege codes assigned to this role',
      }),
    isDefault: z.boolean().default(false).meta({
      example: false,
      description: 'Whether this role is assigned to new users by default',
    }),
  })
  .strict()

export const updateRoleSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().nullable().optional(),
    permissions: z.array(permissionCodeSchema).min(1).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()

export const roleIdParamSchema = z.object({
  id: objectIdSchema,
})

export type CreateRoleInput = z.infer<typeof createRoleSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>
