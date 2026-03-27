import { createLogger } from '@mes/logger'
import { config } from '../config/index.js'

export const logger = createLogger({ level: config.LOG_LEVEL, serviceName: 'realtime' })
