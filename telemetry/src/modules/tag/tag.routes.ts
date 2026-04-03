import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams } from '../../core/middleware/validate.js'
import * as tagController from './tag.controller.js'
import { createTagSchema, tagIdParamSchema, updateTagSchema } from './tag.validators.js'
import * as tagValueController from './tag-value.controller.js'
import { writeCommandSchema, writeValueSchema } from './tag-value.validators.js'

const router = Router()

router.get('/tags', requirePermission('readTags'), tagController.getTags)

router.get(
  '/tags/:id',
  requirePermission('readTags'),
  validateParams(tagIdParamSchema),
  tagController.getTagById,
)

router.post(
  '/tags',
  requirePermission('createTags'),
  validateBody(createTagSchema),
  tagController.createTag,
)

router.patch(
  '/tags/:id',
  requirePermission('writeTags'),
  validateParams(tagIdParamSchema),
  validateBody(updateTagSchema),
  tagController.updateTag,
)

router.delete(
  '/tags/:id',
  requirePermission('deleteTags'),
  validateParams(tagIdParamSchema),
  tagController.deleteTag,
)

router.post(
  '/tags/:id/values',
  requirePermission('writeTagValues'),
  validateParams(tagIdParamSchema),
  validateBody(writeValueSchema),
  tagValueController.writeValue,
)

router.post(
  '/tags/:id/command',
  requirePermission('sendTagCommands'),
  validateParams(tagIdParamSchema),
  validateBody(writeCommandSchema),
  tagValueController.writeCommand,
)

export default router
