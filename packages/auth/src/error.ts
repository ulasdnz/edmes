import { CustomError } from '@mes/core'

export class AuthError extends CustomError {
  public readonly isOperational: boolean

  constructor(statusCode: number, message: string) {
    super(statusCode, message)
    this.name = 'AuthError'
    this.isOperational = true
    Object.setPrototypeOf(this, AuthError.prototype)
  }
}
