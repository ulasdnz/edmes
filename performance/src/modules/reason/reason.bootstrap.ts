import { Types } from 'mongoose'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { logger } from '../../lib/logger.js'
import { Reason } from './reason.model.js'

export const MICRO_STOP_CODE = 'MICRO_STOP'

const MICRO_STOP_TEMPLATE = {
  code: MICRO_STOP_CODE,
  name: 'Micro Stop',
  description:
    'System-managed reason assigned to brief unplanned stops below the configured threshold.',
  usages: ['unplanned_stop'] as const,
  affectsOee: false,
  isSystemDefault: true,
  isActive: true,
  canStartManually: false,
  canBeScheduled: false,
  canConvertFromUnplanned: false,
  requiresDescription: false,
}

export async function bootstrapSystemReasons(): Promise<void> {
  const systemActor = new Types.ObjectId(SYSTEM_IDENTITY)

  await Reason.updateOne(
    { code: MICRO_STOP_CODE },
    {
      $setOnInsert: {
        ...MICRO_STOP_TEMPLATE,
        createdBy: systemActor,
        updatedBy: null,
      },
    },
    { upsert: true },
  )

  const doc = await Reason.findOne({ code: MICRO_STOP_CODE }).lean()
  if (!doc) {
    throw new Error('error.micro_stop_missing')
  }

  const invariantsOk =
    Array.isArray(doc.usages) &&
    doc.usages.length === 1 &&
    doc.usages[0] === 'unplanned_stop' &&
    doc.affectsOee === false &&
    doc.isSystemDefault === true &&
    doc.isActive === true

  if (!invariantsOk) {
    logger.error('MICRO_STOP reason violates required invariants', {
      event: 'reason.bootstrap.invariant_violation',
      reasonId: doc._id.toString(),
      usages: doc.usages,
      affectsOee: doc.affectsOee,
      isSystemDefault: doc.isSystemDefault,
      isActive: doc.isActive,
    })
    throw new Error('error.micro_stop_invalid')
  }

  logger.info('System reasons bootstrap verified', {
    event: 'reason.bootstrap.ok',
    microStopReasonId: doc._id.toString(),
  })
}
