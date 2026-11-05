import fs from 'fs'
import path from 'path'

const migrationName = process.argv[2]

if (!migrationName) {
  console.error('❌  Please provide a migration name')
  console.error('👉  Example: npm run migration:create add-user-fields')
  process.exit(1)
}

// Timestamp format: YYYYMMDDHHMMSS
const timestamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, '')
  .slice(0, 14)

const fileName = `${timestamp}-${migrationName}.ts`

const dirPath = path.join(process.cwd(), 'src', 'database', 'migrations')
const filePath = path.join(dirPath, fileName)

if (!fs.existsSync(dirPath)) {
  fs.mkdirSync(dirPath, { recursive: true })
}

const template = `import mongoose from 'mongoose';
import { logger } from '../../lib/logger.js'; 

/**
 * Migration: ${migrationName}
 */
export async function up(): Promise<void> {
  logger.info('Applying migration: ${migrationName}');

  // Use mongoose.connection.collection('name') to ensure decoupling.
  
  // Example (indexes declared on a schema are created at startup; do not create them here):
  // await mongoose.connection
  //   .collection('users')
  //   .updateMany({ locale: { $exists: false } }, { $set: { locale: 'tr' } });
}

export async function down(): Promise<void> {
  logger.info('Reverting migration: ${migrationName}');

  // Example:
  // await mongoose.connection.collection('users').updateMany({}, { $unset: { locale: '' } });
}
`

fs.writeFileSync(filePath, template)

console.log(`✅  Migration created: src/database/migrations/${fileName}`)
