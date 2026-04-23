import { createHttpLoggerMiddleware, createLogger, createMorganMiddleware } from '@mes/logger'
import { config } from '../config/index.js'

export const logger = createLogger({ level: config.LOG_LEVEL, serviceName: 'performance' })
export const morganMiddleware = createMorganMiddleware(logger)
export const httpLoggerMiddleware = createHttpLoggerMiddleware(logger)
