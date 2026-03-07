import { Types } from 'mongoose'
import type { Job } from 'bullmq'
import User from '../../modules/user/user.model.js'
import { logger } from '../../lib/logger.js'

/**
 * Handles department.deleted events.
 *
 * When a department is deleted, nullifies that departmentId for all users
 * who were assigned to it.
 */
export default async function departmentDeletedHandler(job: Job<{ departmentId: string }>) {
  const departmentOid = new Types.ObjectId(job.data.departmentId)

  const result = await User.updateMany(
    { departmentId: departmentOid },
    { $set: { departmentId: null } },
  )

  logger.info(`Nullified department ${job.data.departmentId} for ${result.modifiedCount} users`)
}
