# Migrations

Database migration files for data transformations, and for indexes a schema cannot declare.

## Commands

```bash
# Run all pending migrations (the service also runs them on every start)
pnpm --filter user-service migrate

# Create a new migration file
pnpm --filter user-service migration:create <migration-name>
```

Example:

```bash
pnpm --filter user-service migration:create backfill-user-locale
# Creates: src/database/migrations/20260113014930-backfill-user-locale.ts
```

## File Structure

Migrations are named with a timestamp prefix: `YYYYMMDDHHMMSS-<name>.ts`. Development runs the
TypeScript source and the image the compiled `.js`; the runner records a migration by its name
without the extension, so one applied from either is applied for both.

Each migration exports `up()` and may export `down()`:

```ts
import mongoose from 'mongoose';
import { logger } from '../../lib/logger.js';

/**
 * Migration: backfill-user-locale
 */
export async function up(): Promise<void> {
  logger.info('Applying migration: backfill-user-locale');

  // Use mongoose.connection.collection('name') to ensure decoupling from models
  await mongoose.connection
    .collection('users')
    .updateMany({ locale: { $exists: false } }, { $set: { locale: 'tr' } });
}

export async function down(): Promise<void> {
  logger.info('Reverting migration: backfill-user-locale');

  await mongoose.connection.collection('users').updateMany({}, { $unset: { locale: '' } });
}
```

## Notes

- Migrations run in filename order (the timestamp sets the sequence), once each: applied migrations
  are recorded in the `migrations` collection.
- A migration without `up()` stops startup instead of being skipped.
- Indexes declared on a schema are created at startup (`MONGO_INDEX_STRATEGY=ensure`, the
  production default). Do not create them again in a migration: the same keys under another name
  fail with an index conflict and stop startup.
- Use `mongoose.connection.collection('name')` instead of Model imports to ensure decoupling. Such
  writes bypass the audit log plugin, so a migration's changes are not in `audit_logs`.
