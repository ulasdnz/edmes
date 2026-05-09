export interface ErrorDetail {
  field: string | number
  message: string
}

export interface SuccessResponse<T = void, M = never> {
  data: T
  message?: string
  meta?: M
}

export interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: ErrorDetail[]
    stack?: string
  }
}
