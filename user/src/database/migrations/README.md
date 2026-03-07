# Migrations

Database migration files for schema changes, indexes, and data transformations.

## Commands

```bash
# Run all pending migrations
npm run migrate

# Create a new migration file
npm run migration:create <migration-name>
```

Example:

```bash
npm run migration:create add-user-fields
# Creates: src/database/migrations/20260113014930-add-user-fields.ts
```

## File Structure

Migrations are named with a timestamp prefix: `YYYYMMDDHHMMSS-<name>.ts`

Each migration exports `up()` and `down()` functions:

```ts
import mongoose from 'mongoose';
import { logger } from '../../lib/logger.js';

/**
 * Migration: add-user-index
 */
export async function up(): Promise<void> {
  logger.info('Applying migration: add-user-index');

  // Use mongoose.connection.collection('name') to ensure decoupling from models
  await mongoose.connection
    .collection('users')
    .createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' });
}

export async function down(): Promise<void> {
  logger.info('Reverting migration: add-user-index');

  await mongoose.connection.collection('users').dropIndex('users_email_unique');
}
```

## Notes

- Migrations run in alphabetical order (timestamp ensures correct sequencing)
- Applied migrations are tracked in the `migrations` collection (idempotent execution)
- The `down()` function is optional but recommended for rollback capability
- Use `mongoose.connection.collection('name')` instead of Model imports to ensure decoupling
