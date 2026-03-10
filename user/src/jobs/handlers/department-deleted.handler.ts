import { Types } from 'mongoose'
import { logger } from '../../lib/logger.js'
import User from '../../modules/user/user.model.js'

/**
 * Handles department.deleted events.
 *
 * When a department is deleted, nullifies that departmentId for all users
 * who were assigned to it.
 */
export default async function departmentDeletedHandler(data: { departmentId: string }) {
  const departmentOid = new Types.ObjectId(data.departmentId)

  const result = await User.updateMany(
    { departmentId: departmentOid },
    { $set: { departmentId: null } },
  )

  logger.info(`Nullified department ${data.departmentId} for ${result.modifiedCount} users`)
}
