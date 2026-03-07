import { Types } from 'mongoose'
import type { Job } from 'bullmq'
import User from '../../modules/user/user.model.js'
import { logger } from '../../lib/logger.js'

/**
 * Handles station.deleted events.
 *
 * When a station is deleted, removes that stationId from all users
 * who had it in their stationIds array.
 */
export default async function stationDeletedHandler(job: Job<{ stationId: string }>) {
  const stationOid = new Types.ObjectId(job.data.stationId)

  const result = await User.updateMany(
    { stationIds: stationOid },
    { $pull: { stationIds: stationOid } },
  )

  logger.info(`Removed station ${job.data.stationId} from ${result.modifiedCount} users`)
}
