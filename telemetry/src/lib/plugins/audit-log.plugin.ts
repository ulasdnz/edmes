import { createAuditLogPlugin } from '@mes/core/audit-log'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { logger } from '../logger.js'
import AuditLog from './audit-log.model.js'

// Records every change to the models that use it in this service's audit_logs collection
export default createAuditLogPlugin({ auditLog: AuditLog, logger, systemIdentity: SYSTEM_IDENTITY })
