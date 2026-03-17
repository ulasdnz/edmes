# User Service — Domain Model

> Generated from deep code review. Last updated: 2026-03-17.

---

## Table of Contents

- [Entity Overview](#entity-overview)
- [User](#user)
- [Role](#role)
- [Speciality](#speciality)
- [AuditLog](#auditlog)
- [PasswordRecovery](#passwordrecovery)
- [Entity Relationships](#entity-relationships)
- [Validation Architecture](#validation-architecture)
- [Index Strategy](#index-strategy)

---

## Entity Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Service                             │
│                                                                 │
│   ┌──────────┐    roles[]     ┌──────────┐                      │
│   │   User   │───────────────▶│   Role   │                      │
│   │          │                │          │                      │
│   │          │  specialities[]┌──────────────┐                  │
│   │          │───────────────▶│ Speciality   │                  │
│   │          │                └──────────────┘                  │
│   │          │  departmentId                                    │
│   │          │─ ─ ─ ─ ─ ─ ─ ▶ [station-service]                │
│   │          │  stationIds[]                                    │
│   │          │─ ─ ─ ─ ─ ─ ─ ▶ [station-service]                │
│   └──────────┘                                                  │
│        │                                                        │
│        │ userId    ┌──────────────────┐                          │
│        └──────────▶│ PasswordRecovery │  (TTL: auto-expire)     │
│                    └──────────────────┘                          │
│                                                                 │
│   ┌──────────┐                                                  │
│   │ AuditLog │  (append-only, tracks all model mutations)       │
│   └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘

─────▶  same-service reference (ObjectId)
─ ─ ─▶  cross-service reference (ObjectId, no Mongoose ref)
```

---

## User

**Collection:** `users`
**File:** `user/src/modules/user/user.model.ts`
**Timestamps:** `createdAt`, `updatedAt` (auto-managed)

### Fields

| Field | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | auto | — |
| `username` | String | yes | — | **unique**, trim, lowercase |
| `email` | String | yes | — | **unique**, lowercase, `match: regexes.email` |
| `password` | String | yes | — | `select: false` — never included in queries unless explicitly selected |
| `name` | String | yes | — | trim |
| `surname` | String | yes | — | trim |
| `roles` | ObjectId[] | no | `[]` | indexed, references Role (via virtual) |
| `gender` | String | no | — | enum: `male`, `female`, `other` |
| `countryCode` | String | no | — | free-form |
| `birthDate` | Date | no | — | — |
| `photoUrl` | String | no | `null` | path to uploaded file |
| `language` | String | no | `'en'` | enum: `en`, `tr` |
| `nfcId` | String | no | `null` | **unique + sparse** (allows multiple nulls) |
| `personalNumber` | String | no | `null` | no uniqueness constraint |
| `departmentId` | ObjectId | no | `null` | indexed, **no ref** (cross-service) |
| `stationIds` | ObjectId[] | no | `[]` | indexed, **no ref** (cross-service) |
| `specialities` | ObjectId[] | no | `[]` | references Speciality (no explicit index) |
| `defaultDashboardId` | ObjectId | no | `null` | **no ref** (cross-service) |
| `props` | Map\<String, String\> | no | `new Map()` | extensible key-value metadata |
| `isActivated` | Boolean | no | `true` | — |
| `isActiveDirectoryUser` | Boolean | no | `false` | — |
| `failedLoginAttempts` | Number | no | `0` | `select: false` |
| `lastFailedLoginAt` | Date | no | `null` | `select: false` |
| `passwordChangedAt` | Date | no | — | set on password reset/recovery |
| `createdAt` | Date | auto | auto | — |
| `updatedAt` | Date | auto | auto | — |

### Hidden Fields (`select: false`)

These fields are never returned in standard queries:
- `password` — bcrypt hash, only selected for login verification
- `failedLoginAttempts` — brute force counter
- `lastFailedLoginAt` — last failed login timestamp

### Virtual Fields

```typescript
roleNames: {
  ref: 'Role',
  localField: 'roles',
  foreignField: '_id'
}
```

- Enabled via `toJSON: { virtuals: true }` and `toObject: { virtuals: true }`
- Populated on demand: `getUsers` and `findByIdWithRoles` populate it
- Returns full Role documents (id, name, description) when populated

### Indexes

| Fields | Type | Name | Notes |
|--------|------|------|-------|
| `username` | unique | implicit | from `unique: true` |
| `email` | unique | `users_email_unique` | also created by migration |
| `nfcId` | unique + sparse | implicit | allows multiple null values |
| `roles` | regular | implicit | for user-by-role lookups |
| `departmentId` | regular | implicit | for user-by-department lookups |
| `stationIds` | regular | implicit | for user-by-station lookups |

### TypeScript Type

```typescript
export type IUser = InferSchemaType<typeof userSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}
```

### Zod Validation Rules (Request Boundary)

| Field | Rule | Schema |
|-------|------|--------|
| username | 3-30 chars, `/^[a-z0-9._-]+$/`, trim, lowercase | register, updateMe |
| name | 2-24 chars, trim | register, updateMe |
| surname | min 1, trim | register, updateMe |
| email | `z.email()` | register, updateMe |
| password | 8-20 chars | register, adminCreate, adminReset, recovery |
| gender | `enum ['male', 'female', 'other']` | updateMe, adminUpdate |
| language | `enum ['en', 'tr']` | updateMe, adminUpdate |
| birthDate | `z.coerce.date()` | updateMe, adminUpdate |
| nfcId | `string \| null` | adminUpdate only |
| personalNumber | `string \| null` | adminUpdate only |
| isActivated | `boolean` | adminUpdate only |
| departmentId | `objectIdSchema \| null` | adminUpdate only |
| stationIds | `objectIdSchema[]`, default `[]` | adminUpdate only |
| specialities | `objectIdSchema[]`, default `[]` | adminUpdate only |
| roles | `objectIdSchema[]`, default `[]` | adminUpdate only |
| props | `Record<string, string>` | adminUpdate only |

---

## Role

**Collection:** `roles`
**File:** `user/src/modules/role/role.model.ts`
**Timestamps:** `createdAt`, `updatedAt`

### Fields

| Field | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | auto | — |
| `name` | String | yes | — | **unique**, trim |
| `description` | String | no | `null` | — |
| `permissions` | String[] | no | `[]` | validated at Zod layer against `VALID_PRIVILEGE_CODES` |
| `isDefault` | Boolean | no | `false` | — |
| `createdAt` | Date | auto | auto | — |
| `updatedAt` | Date | auto | auto | — |

### Indexes

| Fields | Type |
|--------|------|
| `name` | unique |

### Permission Validation

The `permissions` array stores string codes from the privilege registry (33 codes across 8 groups). Validation happens at the Zod schema level:

```typescript
permissions: z.array(
  z.string().refine(code => VALID_PRIVILEGE_CODES.has(code))
).min(1)
```

`VALID_PRIVILEGE_CODES` is a `ReadonlySet<string>` built from the `PRIVILEGES` array at startup — O(1) lookup.

### isDefault Flag

Currently a boolean field with no special enforcement in the service layer. It's a UI hint — there is no logic that auto-assigns default roles to new users.

---

## Speciality

**Collection:** `specialities`
**File:** `user/src/modules/speciality/speciality.model.ts`
**Timestamps:** `createdAt`, `updatedAt`

### Fields

| Field | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | auto | — |
| `name` | String | yes | — | **unique**, trim |
| `description` | String | no | `null` | — |
| `createdAt` | Date | auto | auto | — |
| `updatedAt` | Date | auto | auto | — |

### Zod Validation

- `name`: 2-100 chars, trim
- `description`: optional string, nullable on update

Minimal entity — no relationships, no virtuals, no special indexes beyond unique name.

---

## AuditLog

**Collection:** `audit_logs` (explicit)
**File:** `user/src/lib/plugins/audit-log.model.ts`
**Timestamps:** none (manual `timestamp` field)

### Fields

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `timestamp` | Date | yes | `Date.now` | when the operation occurred |
| `operation` | String | yes | — | enum: `create`, `update`, `delete` |
| `model` | String | yes | — | indexed, model name (e.g. `'User'`, `'Role'`) |
| `documentId` | String | yes | — | indexed, the `_id` of the affected document |
| `userId` | String | yes | — | indexed, who performed the operation |
| `ip` | String | no | `''` | client IP from request context |
| `traceId` | String | no | `''` | distributed trace ID from ALS |
| `document` | Mixed | no | `null` | post-operation document snapshot |
| `previousDocument` | Mixed | no | `null` | pre-operation snapshot (updates only) |

### Compound Indexes

```
{ model: 1, documentId: 1, timestamp: -1 }   — "What happened to this document?"
{ userId: 1, timestamp: -1 }                 — "What did this user do?"
```

### Design Notes

- **Append-only**: no update or delete operations by design
- **No versionKey**: `versionKey: false` on schema
- **Sensitive field masking**: `password`, `secret`, `token`, `accessToken` → `'****'`
- **Silent failures**: audit writes never block main operations — errors are swallowed
- **System identity**: `'ffffffffffffffffffffffff'` when no request context (seeders, migrations, background jobs)

### Audit Plugin Hooks

Applied to: `User`, `Role`, `Speciality`. NOT applied to: `AuditLog`, `PasswordRecovery`.

| Hook | Mongoose Event | Audit Operation |
|------|----------------|-----------------|
| `post('save')` | `doc.save()` | `create` |
| `pre('findOneAndUpdate')` | query | stores old doc in WeakMap |
| `post('findOneAndUpdate')` | query | `update` (with old/new diff) |
| `post('findOneAndDelete')` | query | `delete` |

**Known behavior**: `post('save')` fires on both initial creation and subsequent `doc.save()` updates. Operations using `Object.assign(user, data); user.save()` pattern (updateUser, updateAvatar, adminUpdateUser, adminResetPassword) produce audit entries with `operation: 'create'` instead of `'update'`.

### Context Resolution

```typescript
const { userId, ip, traceId } = getContext() ?? {
  userId: SYSTEM_IDENTITY,
  ip: '',
  traceId: ''
}
```

---

## PasswordRecovery

**Collection:** `password_recoveries` (explicit)
**File:** `user/src/modules/password-recovery/password-recovery.model.ts`
**Timestamps:** `createdAt`, `updatedAt`

### Fields

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `_id` | ObjectId | auto | auto | — |
| `userId` | ObjectId | yes | — | `ref: 'User'`, indexed |
| `codeHash` | String | yes | — | bcrypt hash of 5-digit recovery code |
| `expiredAt` | Date | yes | — | TTL index target |
| `isUsed` | Boolean | yes | `false` | — |
| `createdAt` | Date | auto | auto | — |
| `updatedAt` | Date | auto | auto | — |

### Indexes

| Fields | Type | Notes |
|--------|------|-------|
| `{ expiredAt: 1 }` | TTL | `expireAfterSeconds: 0` — MongoDB auto-deletes when `expiredAt` passes |
| `{ userId: 1, isUsed: 1, expiredAt: 1 }` | compound | active token lookups |

### Lifecycle

1. **Created** when user requests password recovery
2. **All siblings invalidated** (previous active codes get `expiredAt = now`)
3. **Verified** via bcrypt comparison (up to 5 active docs checked)
4. **Used** — `isUsed = true` after successful password reset
5. **Expired** — MongoDB TTL index auto-deletes the document

### Constants (Not Configurable)

```typescript
MAX_ATTEMPTS_PER_HOUR = 5        // rate limit per user
RECOVERY_CODE_TTL_MS  = 120000   // 2 minutes
RECOVERY_LOOKUP_LIMIT = 5        // max active docs to check
```

---

## Entity Relationships

### Same-Service References

```
User.roles[] ──────────▶ Role._id
  │ Type: ObjectId array
  │ Population: virtual 'roleNames' with ref: 'Role'
  │ Cascade on Role delete: $pull from all users (service-level)
  │ Cascade on User delete: N/A (user is gone)
  └ Orphan risk: If $pull fails after role delete, stale IDs remain

User.specialities[] ───▶ Speciality._id
  │ Type: ObjectId array
  │ Population: none (raw IDs only)
  │ Cascade on Speciality delete: NONE — orphaned IDs remain
  └ Orphan risk: YES — no cleanup handler exists

PasswordRecovery.userId ▶ User._id
  │ Type: ObjectId with ref: 'User'
  │ Cascade on User delete: NONE — documents TTL-expire naturally
  └ Not a problem in practice (expired docs are auto-cleaned)
```

### Cross-Service References

```
User.departmentId ─ ─ ─▶ [station-service] Department._id
  │ Type: ObjectId, no Mongoose ref
  │ Cascade: handled via Redis Streams 'department.deleted' event
  │ Handler: sets departmentId = null on affected users
  └ Safe: event handler exists

User.stationIds[] ─ ─ ─▶ [station-service] Station._id
  │ Type: ObjectId array, no Mongoose ref
  │ Cascade: expected via 'station.deleted' event (not yet implemented?)
  └ Risk: orphaned station IDs if no handler

User.defaultDashboardId ─▶ [future service] Dashboard._id
  │ Type: ObjectId, no Mongoose ref
  │ Cascade: none defined
  └ Risk: orphaned ID if dashboard deleted
```

### Relationship Matrix

| From | To | Cardinality | Cascade Strategy |
|------|----|-------------|------------------|
| User → Role | same-service | many-to-many | `$pull` on delete (service-level) |
| User → Speciality | same-service | many-to-many | **none** |
| User → Department | cross-service | many-to-one | Redis Streams event |
| User → Station | cross-service | many-to-many | expected via event |
| User → Dashboard | cross-service | one-to-one | **none** |
| PasswordRecovery → User | same-service | many-to-one | TTL auto-expire |
| AuditLog → any model | same-service | many-to-one | append-only, no cascade |

---

## Validation Architecture

### Two-Layer Validation

```
Request ──▶ [Zod Schema] ──▶ [Mongoose Schema] ──▶ MongoDB
              │                    │                    │
              │ Format, range,     │ Required, enum,    │ Unique constraints
              │ regex, transform   │ type coercion,     │ (error code 11000)
              │                    │ defaults            │
              └ 400 ZodError       └ (rarely triggered)  └ 409 Conflict
```

**Zod** (request boundary): All format validation, length limits, regex patterns, enum checks, type coercion (dates), transforms (trim, lowercase). Runs in `validate*` middleware before controller.

**Mongoose** (database boundary): Type enforcement, `required`, `enum`, default values. Rarely triggers validation errors because Zod catches most issues first.

**MongoDB** (storage boundary): Unique index violations surface as error code `11000`. Service layer catches these and returns 409 with descriptive i18n keys.

### Schema Hierarchy

```
registerSchema (base user fields, required)
    │
    ├── loginSchema (email + password only)
    │
    ├── updateMeSchema (all registerSchema fields optional + self-editable extras)
    │       │
    │       └── adminUpdateUserSchema (extends updateMeSchema + admin-only fields)
    │               │
    │               └── adminCreateUserSchema (registerSchema ∪ adminUpdateUserSchema)
    │
    └── adminResetPasswordSchema (password only)

createRoleSchema (name required, permissions min 1)
    └── updateRoleSchema (all optional)

createSpecialitySchema (name required)
    └── updateSpecialitySchema (all optional, description nullable)
```

### objectIdSchema

Used across all validators for path params and body fields containing ObjectId references:

```typescript
z.string().refine(val => Types.ObjectId.isValid(val), {
  message: 'error.invalid_id'
})
```

---

## Index Strategy

### Environment-Based Strategy

```typescript
MONGO_INDEX_STRATEGY:
  production → 'ensure'    // createIndex on connect (idempotent)
  other      → 'off'       // rely on schema definitions only
```

### Full Index Inventory

| Collection | Index | Type | Purpose |
|------------|-------|------|---------|
| `users` | `username` | unique | login, lookup |
| `users` | `email` | unique | login, lookup, registration check |
| `users` | `nfcId` | unique + sparse | NFC card lookup (nulls allowed) |
| `users` | `roles` | regular | filter users by role |
| `users` | `departmentId` | regular | filter users by department |
| `users` | `stationIds` | regular | filter users by station |
| `roles` | `name` | unique | prevent duplicate role names |
| `specialities` | `name` | unique | prevent duplicate speciality names |
| `audit_logs` | `{ model, documentId, timestamp }` | compound | document history queries |
| `audit_logs` | `{ userId, timestamp }` | compound | user activity queries |
| `password_recoveries` | `{ expiredAt }` | TTL | auto-delete expired tokens |
| `password_recoveries` | `{ userId, isUsed, expiredAt }` | compound | active token lookups |

### Migration Note

`20260102205332-add-user-index.ts` creates `users_email_unique` index imperatively. This is redundant with the `unique: true` on the Mongoose schema — the index is already created by Mongoose on connect. The migration exists for explicit control over index naming.

---

## Seeder

**File:** `user/src/database/seeders/user.seeder.ts`

- Generates `N` users (default 10) using `@faker-js/faker`
- All get password `'Test123456'` (bcrypt, 10 rounds)
- Wipes collection first (`deleteMany({})`)
- Uses `insertMany` — bypasses `save` hooks, so **audit log does not fire** for seeded data
- No roles, specialities, or departments assigned

---

## Props Map

The `props` field (`Map<String, String>`) on User is an extensible key-value store for custom metadata. Use cases include:

- Custom factory-specific user attributes
- Integration identifiers from external systems
- Per-deployment configuration data

The `GET /users/props-keys` endpoint returns all distinct keys across all users via aggregation:

```javascript
{ $project: { propKeys: { $objectToArray: '$props' } } }
{ $unwind: '$propKeys' }
{ $group: { _id: null, keys: { $addToSet: '$propKeys.k' } } }
```

This enables dynamic UI: filter dropdowns can be built from the actual keys in use.
