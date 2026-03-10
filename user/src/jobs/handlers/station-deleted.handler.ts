import { Types } from 'mongoose'
import { logger } from '../../lib/logger.js'
import User from '../../modules/user/user.model.js'

/**
 * Handles station.deleted events.
 *
 * When a station is deleted, removes that stationId from all users
 * who had it in their stationIds array.
 */
export default async function stationDeletedHandler(data: { stationId: string }) {
  const stationOid = new Types.ObjectId(data.stationId)

  const result = await User.updateMany(
    { stationIds: stationOid },
    { $pull: { stationIds: stationOid } },
  )

  logger.info(`Removed station ${data.stationId} from ${result.modifiedCount} users`)
}
