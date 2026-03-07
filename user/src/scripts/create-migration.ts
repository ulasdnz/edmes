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
  
  // Example:
  // const db = mongoose.connection.db;
  // await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down(): Promise<void> {
  logger.info('Reverting migration: ${migrationName}');

  // Example:
  // const db = mongoose.connection.db;
  // await db.collection('users').dropIndex('users_email_unique');
}
`

fs.writeFileSync(filePath, template)

console.log(`✅  Migration created: src/database/migrations/${fileName}`)
