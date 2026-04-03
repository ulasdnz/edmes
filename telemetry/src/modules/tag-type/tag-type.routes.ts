import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as tagTypeController from './tag-type.controller.js'
import {
  createTagTypeSchema,
  tagTypeIdParamSchema,
  updateTagTypeSchema,
} from './tag-type.validators.js'

const router = Router()

router.get('/tag-types', requirePermission('readTagTypes'), tagTypeController.getTagTypes)

router.get(
  '/tag-types/:id',
  requirePermission('readTagTypes'),
  validateParams(tagTypeIdParamSchema),
  tagTypeController.getTagTypeById,
)

router.post(
  '/tag-types',
  requirePermission('createTagTypes'),
  validateBody(createTagTypeSchema),
  tagTypeController.createTagType,
)

router.patch(
  '/tag-types/:id',
  requirePermission('writeTagTypes'),
  validateParams(tagTypeIdParamSchema),
  validateBody(updateTagTypeSchema),
  tagTypeController.updateTagType,
)

router.delete(
  '/tag-types/:id',
  requirePermission('deleteTagTypes'),
  validateParams(tagTypeIdParamSchema),
  tagTypeController.deleteTagType,
)

export default router
