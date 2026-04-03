import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

const nameSchema = z
  .string({ message: 'validation.edge_device_name_required' })
  .trim()
  .min(2, { message: 'validation.edge_device_name_min' })
  .max(50, { message: 'validation.edge_device_name_max' })

const deviceKeySchema = z
  .string({ message: 'validation.device_key_required' })
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, { message: 'validation.device_key_format' })

const ipAddressSchema = z
  .string({ message: 'validation.ip_address_required' })
  .trim()
  .min(1, { message: 'validation.ip_address_required' })

export const createEdgeDeviceSchema = z
  .object({
    name: nameSchema,
    deviceKey: deviceKeySchema,
    desc: z.string().nullable().optional(),
    ipAddress: ipAddressSchema,
  })
  .strict()

export const updateEdgeDeviceSchema = z
  .object({
    name: nameSchema.optional(),
    desc: z.string().nullable().optional(),
    ipAddress: ipAddressSchema.optional(),
  })
  .strict()

export const edgeDeviceIdParamSchema = z.object({
  id: objectIdSchema,
})

export type CreateEdgeDeviceInput = z.infer<typeof createEdgeDeviceSchema>
export type UpdateEdgeDeviceInput = z.infer<typeof updateEdgeDeviceSchema>
