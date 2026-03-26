/**
 * Protected speciality routes — authenticate applied at prefix level.
 */

import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as specialityController from './speciality.controller.js'
import {
  createSpecialitySchema,
  specialityIdParamSchema,
  updateSpecialitySchema,
} from './speciality.validators.js'

const router = Router()

router.get(
  '/specialities',
  requirePermission('readSpecialities'),
  specialityController.getSpecialities,
)

router.get(
  '/specialities/:id',
  requirePermission('readSpecialities'),
  validateParams(specialityIdParamSchema),
  specialityController.getSpecialityById,
)

router.post(
  '/specialities',
  requirePermission('createSpecialities'),
  validateBody(createSpecialitySchema),
  specialityController.createSpeciality,
)

router.patch(
  '/specialities/:id',
  requirePermission('writeSpecialities'),
  validateParams(specialityIdParamSchema),
  validateBody(updateSpecialitySchema),
  specialityController.updateSpeciality,
)

router.delete(
  '/specialities/:id',
  requirePermission('deleteSpecialities'),
  validateParams(specialityIdParamSchema),
  specialityController.deleteSpeciality,
)

export default router
