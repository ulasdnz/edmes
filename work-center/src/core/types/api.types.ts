export interface ErrorDetail {
  field: string | number
  message: string
}

export interface BaseResponse {
  success: boolean
  message: string
}

export interface SuccessResponse<T = void> extends BaseResponse {
  success: true
  data: T
}

export interface ErrorResponse extends BaseResponse {
  success: false
  errors?: ErrorDetail[] | null
  stack?: string
}
