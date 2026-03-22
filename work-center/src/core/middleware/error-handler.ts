/**
 * Error handler — thin wrapper over @mes/core's createErrorHandler.
 *
 * Binds the shared error handler to this service's logger and NODE_ENV.
 */

import { createErrorHandler } from '@mes/core'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'

export const errorHandler = createErrorHandler({ logger, nodeEnv: config.NODE_ENV })
