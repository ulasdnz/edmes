// Errors

export type { default as CustomErrorDefault } from './errors/index.js'
export { CustomError } from './errors/index.js'
export type { ErrorHandlerOptions } from './middleware/error-handler.js'
// Middleware
export { createErrorHandler } from './middleware/error-handler.js'
export type { RequestContext } from './middleware/request-context.js'
export {
  als,
  contextMiddleware,
  getContext,
  getTraceId,
  runInContext,
  setUserId,
} from './middleware/request-context.js'

export { validateBody, validateParams, validateQuery } from './middleware/validate.js'
// Shutdown
export { isShuttingDown, setShuttingDown } from './shutdown.js'
// Types
export type {
  ErrorDetail,
  ErrorResponse,
  MongoError,
  SuccessResponse,
} from './types/index.js'
