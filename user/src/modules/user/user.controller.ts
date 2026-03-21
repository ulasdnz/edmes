import type { Request, Response } from 'express'

import CustomError from '../../core/errors/index.js'
import type { SuccessResponse } from '../../core/types/api.types.js'
import * as userService from './user.service.js'
import type { AuthResponse, UserResponse } from './user.types.js'
import type {
  AdminCreateUserInput,
  AdminResetPasswordInput,
  AdminUpdateUserInput,
  UserListInput,
} from './user.validators.js'

export async function register(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const user = await userService.registerUser(req.body)

  res.status(201).json({
    success: true,
    message: req.t('success.register'),
    data: user,
  })
}

export async function login(req: Request, res: Response<SuccessResponse<AuthResponse>>) {
  const result = await userService.loginUser(req.body)

  res.json({
    success: true,
    message: req.t('success.login'),
    data: result,
  })
}

export async function deleteUser(req: Request, res: Response<SuccessResponse<void>>) {
  const userId = req.user!.id
  await userService.deleteUser(userId)

  res.json({
    success: true,
    message: req.t('success.delete'),
    data: undefined,
  })
}

export async function updateUser(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const userId = req.user!.id
  const result = await userService.updateUser(userId, req.body)

  res.json({
    success: true,
    message: req.t('success.update'),
    data: result,
  })
}

export async function updateAvatar(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const userId = req.user!.id

  if (!req.file) {
    throw new CustomError(400, 'user.avatar_required')
  }

  const result = await userService.updateAvatar(userId, req.file)
  res.json({
    success: true,
    message: req.t('success.avatar_update'),
    data: result,
  })
}

export async function getUser(req: Request, res: Response<SuccessResponse<UserResponse>>) {
  const userId = req.user!.id
  const user = await userService.getUser(userId)

  res.json({
    success: true,
    message: req.t('success.get'),
    data: user,
  })
}

export async function getUsers(req: Request, res: Response) {
  const result = await userService.getUsers(req.query as unknown as UserListInput)

  res.json({
    success: true,
    message: req.t('success.get_all'),
    ...result,
  })
}

export async function getUserById(
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.findById(req.params.id)

  res.json({
    success: true,
    message: req.t('success.get'),
    data: user,
  })
}

// ─── Lookup & Helper Operations ──────────────────────────────────────────────

export async function getUserByUsername(
  req: Request<{ username: string }>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.findByUsername(req.params.username)
  res.json({
    success: true,
    message: req.t('success.get'),
    data: user,
  })
}

export async function getUserByEmail(
  req: Request<{ email: string }>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.findByEmail(req.params.email)
  res.json({
    success: true,
    message: req.t('success.get'),
    data: user,
  })
}

export async function getUserByIdWithRoles(
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.findByIdWithRoles(req.params.id)
  res.json({
    success: true,
    message: req.t('success.get'),
    data: user,
  })
}

export async function getUserRolesAndPermissions(
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<{ roles: string[]; permissions: string[] }>>,
) {
  const data = await userService.getUserRolesAndPermissions(req.params.id)

  res.json({
    success: true,
    message: req.t('success.get'),
    data,
  })
}

export async function getUserAuthStatus(
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<{ isActivated: boolean; passwordChangedAt: string | null }>>,
) {
  const data = await userService.getUserAuthStatus(req.params.id)

  res.json({
    success: true,
    message: req.t('success.get'),
    data,
  })
}

export async function getUsersLanguages(req: Request, res: Response<SuccessResponse<string[]>>) {
  const languages = userService.getLanguages()
  res.json({
    success: true,
    message: req.t('success.get'),
    data: languages,
  })
}

export async function getUsersPropsKeys(req: Request, res: Response<SuccessResponse<string[]>>) {
  const keys = await userService.getPropsKeys()
  res.json({
    success: true,
    message: req.t('success.get'),
    data: keys,
  })
}

// ─── Admin Controller Operations ─────────────────────────────────────────────

export async function adminCreateUser(
  req: Request<unknown, unknown, AdminCreateUserInput>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.adminCreateUser(req.body)

  res.status(201).json({
    success: true,
    message: req.t('success.create'),
    data: user,
  })
}

export async function adminUpdateUser(
  req: Request<{ id: string }, unknown, AdminUpdateUserInput>,
  res: Response<SuccessResponse<UserResponse>>,
) {
  const user = await userService.adminUpdateUser(req.params.id, req.body)

  res.json({
    success: true,
    message: req.t('success.update'),
    data: user,
  })
}

export async function adminDeleteUser(
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<void>>,
) {
  await userService.deleteUser(req.params.id)

  res.json({
    success: true,
    message: req.t('success.delete'),
    data: undefined,
  })
}

export async function adminResetPassword(
  req: Request<{ id: string }, unknown, AdminResetPasswordInput>,
  res: Response<SuccessResponse<void>>,
) {
  await userService.adminResetPassword(req.params.id, req.body)

  res.json({
    success: true,
    message: req.t('success.password_reset'),
    data: undefined,
  })
}

// ─── Microservice Sync Operations ────────────────────────────────────────────

export async function checkUserDependencies(
  req: Request<
    unknown,
    unknown,
    unknown,
    { fieldName: 'departmentId' | 'workCenterIds'; fieldValue: string }
  >,
  res: Response<SuccessResponse<{ inUse: boolean }>>,
) {
  const { fieldName, fieldValue } = req.query
  const inUse = await userService.checkUserDependencies(fieldName, fieldValue)

  res.json({
    success: true,
    message: req.t('success.get'),
    data: { inUse },
  })
}
