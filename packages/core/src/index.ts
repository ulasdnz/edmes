// Errors
export { CustomError } from './errors/index.js'
export type { default as CustomErrorDefault } from './errors/index.js'

// Middleware
export { createErrorHandler } from './middleware/error-handler.js'
export type { ErrorHandlerOptions } from './middleware/error-handler.js'

export {
  contextMiddleware,
  getContext,
  getTraceId,
  setUserId,
  als,
} from './middleware/request-context.js'
export type { RequestContext } from './middleware/request-context.js'

export { validateBody, validateParams, validateQuery } from './middleware/validate.js'

// Types
export type {
  BaseResponse,
  ErrorDetail,
  ErrorResponse,
  MongoError,
  SuccessResponse,
} from './types/index.js'

// Shutdown
export { isShuttingDown, setShuttingDown } from './shutdown.js'
