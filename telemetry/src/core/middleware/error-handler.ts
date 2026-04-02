import { createErrorHandler } from '@mes/core'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'

export const errorHandler = createErrorHandler({ logger, nodeEnv: config.NODE_ENV })
