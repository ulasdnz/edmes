import type { IUser } from './user.model.js'

export type UserResponse = Omit<
  IUser,
  'password' | 'restore' | 'failedLoginAttempts' | 'lastFailedLoginAt'
>

export interface AuthResponse {
  user: UserResponse
  token: string
}

export interface RuntimeContextResponse {
  plantTimezone: string
  serverTime: string
  permissions: string[]
}
