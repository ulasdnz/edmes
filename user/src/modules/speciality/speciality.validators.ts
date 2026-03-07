import { z } from 'zod'
import 'zod-openapi'
import { objectIdSchema } from '../../utils/validators.js'

const nameSchema = z
  .string({ message: 'validation.speciality_name_required' })
  .trim()
  .min(2, { message: 'validation.speciality_name_min' })
  .max(100, { message: 'validation.speciality_name_max' })
  .meta({ example: 'Maintenance', description: 'Name of the user speciality' })

export const createSpecialitySchema = z
  .object({
    name: nameSchema,
    description: z.string().optional().meta({
      example: 'Equipment maintenance and repair',
      description: 'Description of the speciality',
    }),
  })
  .strict()

export const updateSpecialitySchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().nullable().optional(),
  })
  .strict()

export const specialityIdParamSchema = z.object({
  id: objectIdSchema,
})

export type CreateSpecialityInput = z.infer<typeof createSpecialitySchema>
export type UpdateSpecialityInput = z.infer<typeof updateSpecialitySchema>
