import { logger } from '../../lib/logger.js'
import { connectDB, disconnectDB } from '../../utils/db.js'
import { seedUsers } from './user.seeder.js'

;(async () => {
  try {
    await connectDB()
    logger.info('Starting all seeders...', { event: 'seed.start' })
    await seedUsers()
    logger.info('All seeders completed successfully', { event: 'seed.completed' })
  } catch (error) {
    logger.error('Seeding failed', {
      event: 'seed.failed',
      error: error instanceof Error ? error.message : error,
    })
    process.exitCode = 1
  } finally {
    await disconnectDB()
  }
})()
