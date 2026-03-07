export class CustomError extends Error {
  public readonly statusCode: number
  public readonly details?: Record<string, unknown>

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message)
    this.statusCode = statusCode
    this.details = details
    this.name = this.constructor.name
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

export default CustomError
