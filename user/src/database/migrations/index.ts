import fs from 'fs'
import mongoose from 'mongoose'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { logger } from '../../lib/logger.js'
import { connectDB, disconnectDB } from '../../utils/db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATION_COLLECTION = 'migrations'

interface MigrationRecord {
  name: string
  appliedAt: Date
}

// The migrations in a directory in filename order, each named without its extension. Development
// runs the TypeScript sources and the image the compiled JavaScript, so both count, and a migration
// applied from one is applied for the other. Declaration files, tests and this runner do not
export function listMigrations(dir: string): { name: string; file: string }[] {
  return fs
    .readdirSync(dir)
    .filter(
      file =>
        /\.(ts|js)$/.test(file) &&
        !file.endsWith('.d.ts') &&
        !/\.(test|spec)\.(ts|js)$/.test(file) &&
        !/^index\.(ts|js)$/.test(file),
    )
    .sort()
    .map(file => ({ name: file.replace(/\.(ts|js)$/, ''), file: path.join(dir, file) }))
}

export async function runMigrations(dir: string = __dirname): Promise<void> {
  const needsConnect = mongoose.connection.readyState !== 1
  if (needsConnect) await connectDB()

  try {
    const collection = mongoose.connection.collection<MigrationRecord>(MIGRATION_COLLECTION)
    await collection.createIndex({ name: 1 }, { unique: true })

    const applied = new Set(
      (await collection.find({}, { projection: { _id: 0, name: 1 } }).toArray()).map(m => m.name),
    )
    const pending = listMigrations(dir).filter(migration => !applied.has(migration.name))

    for (const migration of pending) {
      const module = await import(pathToFileURL(migration.file).href)
      // A migration that cannot run stops startup instead of being skipped on every boot
      if (typeof module.up !== 'function') {
        throw new Error(`Migration ${migration.name} exports no up() function`)
      }

      logger.info('Running migration', { event: 'db.migration.started', migration: migration.name })
      await module.up()
      await collection.insertOne({ name: migration.name, appliedAt: new Date() })
      logger.info('Migration applied', { event: 'db.migration.applied', migration: migration.name })
    }

    logger.info('Migrations up to date', {
      event: 'db.migrations.completed',
      applied: pending.length,
      alreadyApplied: applied.size,
    })
  } finally {
    if (needsConnect) await disconnectDB()
  }
}

if (process.argv[1] === __filename) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error('Migration runner failed', {
        event: 'db.migrations.failed',
        error: error instanceof Error ? error.message : error,
      })
      process.exit(1)
    })
}
