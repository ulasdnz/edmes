import fs from 'fs'
import mongoose from 'mongoose'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { logger } from '../../lib/logger.js'
import { connectDB, disconnectDB } from '../../utils/db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATIONS_DIR = path.join(__dirname)
const MIGRATION_COLLECTION = 'migrations'

interface MigrationRecord {
  name: string
  appliedAt: Date
}

export async function runMigrations() {
  const needsConnect = mongoose.connection.readyState !== 1
  if (needsConnect) await connectDB()

  try {
    const collection = mongoose.connection.collection<MigrationRecord>(MIGRATION_COLLECTION)
    await collection.createIndex({ name: 1 }, { unique: true })

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.ts') && f !== 'index.ts')
      .sort()

    const appliedMigrationNames = new Set(
      (await collection.find({}, { projection: { _id: 0, name: 1 } }).toArray()).map(m => m.name),
    )

    for (const file of files) {
      if (appliedMigrationNames.has(file)) {
        logger.info(`Skipping already applied migration: ${file}`)
        continue
      }

      const migrationPath = path.join(MIGRATIONS_DIR, file)
      const migration = await import(pathToFileURL(migrationPath).href)

      if (typeof migration.up !== 'function') {
        logger.warn(`Migration has no up() function, skipping: ${file}`)
        continue
      }

      logger.info(`Running migration: ${file}`)
      await migration.up()

      await collection.insertOne({
        name: file,
        appliedAt: new Date(),
      })

      logger.info(`Migration completed: ${file}`)
    }

    logger.info('All pending migrations processed successfully')
  } finally {
    if (needsConnect) await disconnectDB()
  }
}

if (process.argv[1] === __filename) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error('Migration runner failed', error)
      process.exit(1)
    })
}
