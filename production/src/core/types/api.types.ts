export interface ErrorDetail {
  field: string | number
  message: string
}

export interface SuccessResponse<T = void> {
  data: T
  message?: string
}

export interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: ErrorDetail[]
    stack?: string
  }
}
