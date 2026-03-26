/**
 * Protected user routes — authenticate applied at prefix level.
 * No auth/permission imports needed here.
 */

import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { upload } from '../../core/middleware/upload.js'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as userController from './user.controller.js'
import {
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  updateMeSchema,
  userIdParamSchema,
  userListSchema,
} from './user.validators.js'

const router = Router()

// "me" endpoints — any authenticated user
router.get('/users/me', userController.getUser)
router.patch('/users/me', validateBody(updateMeSchema), userController.updateUser)
router.patch('/users/me/avatar', upload.single('photo'), userController.updateAvatar)
router.delete('/users/me', userController.deleteUser)

// Admin endpoints — require specific permissions
router.post(
  '/users',
  requirePermission('createUsers'),
  validateBody(adminCreateUserSchema),
  userController.adminCreateUser,
)
router.patch(
  '/users/:id',
  requirePermission('writeUsers'),
  validateParams(userIdParamSchema),
  validateBody(adminUpdateUserSchema),
  userController.adminUpdateUser,
)
router.delete(
  '/users/:id',
  requirePermission('deleteUsers'),
  validateParams(userIdParamSchema),
  userController.adminDeleteUser,
)
router.post(
  '/users/:id/reset-password',
  requirePermission('writeUsers'),
  validateParams(userIdParamSchema),
  validateBody(adminResetPasswordSchema),
  userController.adminResetPassword,
)

// Custom param validation schemas for lookups
import { z } from 'zod'

const usernameParamSchema = z.object({ username: z.string() })
const emailParamSchema = z.object({ email: z.email() })

const checkDependencyQuerySchema = z.object({
  fieldName: z.enum(['departmentId', 'workCenterIds']),
  fieldValue: z.string(),
})

// ─── System Sync Routes ──────────────────────────────────────────────────────

router.get(
  '/users/check-dependencies',
  requirePermission('readUsers'),
  validateQuery(checkDependencyQuerySchema),
  userController.checkUserDependencies,
)

router.get(
  '/users',
  requirePermission('readUsers'),
  validateQuery(userListSchema),
  userController.getUsers,
)
router.get(
  '/users/by-username/:username',
  requirePermission('readUsers'),
  validateParams(usernameParamSchema),
  userController.getUserByUsername,
)
router.get(
  '/users/by-email/:email',
  requirePermission('readUsers'),
  validateParams(emailParamSchema),
  userController.getUserByEmail,
)
router.get(
  '/users/:id/roles',
  requirePermission('readUsers'),
  validateParams(userIdParamSchema),
  userController.getUserByIdWithRoles,
)
router.get(
  '/users/:id/roles-permissions',
  requirePermission('readUsers'),
  validateParams(userIdParamSchema),
  userController.getUserRolesAndPermissions,
)
router.get(
  '/users/:id/auth-status',
  requirePermission('readUsers'),
  validateParams(userIdParamSchema),
  userController.getUserAuthStatus,
)
router.get(
  '/users/:id/auth-context',
  requirePermission('readUsers'),
  validateParams(userIdParamSchema),
  userController.getUserAuthContext,
)
router.get('/users/languages', requirePermission('readUsers'), userController.getUsersLanguages)
router.get(
  '/users/custom-field-keys',
  requirePermission('readUsers'),
  userController.getUsersPropsKeys,
)

router.get(
  '/users/:id',
  requirePermission('readUsers'),
  validateParams(userIdParamSchema),
  userController.getUserById,
)

export default router
