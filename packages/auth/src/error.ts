export class AuthError extends Error {
  public statusCode: number
  public isOperational: boolean

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
    this.isOperational = true
    Object.setPrototypeOf(this, AuthError.prototype)
  }
}
