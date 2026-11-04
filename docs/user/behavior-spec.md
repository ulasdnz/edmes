# User Service — Behavior Spec

> Generated from deep code review. Last updated: 2026-03-22.

---

## Table of Contents

- [Authentication Flow](#authentication-flow)
- [Login Blocking (Brute Force Protection)](#login-blocking-brute-force-protection)
- [User Lifecycle](#user-lifecycle)
- [Role Lifecycle](#role-lifecycle)
- [Speciality Lifecycle](#speciality-lifecycle)
- [Cache Invalidation Rules](#cache-invalidation-rules)
- [Event Publishing](#event-publishing)
- [Event Consumption](#event-consumption)
- [Cascading Behaviors](#cascading-behaviors)
- [Audit Logging](#audit-logging)
- [Permission Enforcement](#permission-enforcement)
- [Self vs Admin Field Access](#self-vs-admin-field-access)
- [File Upload Behavior](#file-upload-behavior)
- [Cross-Service Dependencies](#cross-service-dependencies)
- [Edge Cases & Known Behaviors](#edge-cases--known-behaviors)

---

## Authentication Flow

### Registration

```
Client                    Service                     MongoDB         Redis Stream
  │                          │                           │                │
  │  POST /auth/register     │                           │                │
  │─────────────────────────▶│                           │                │
  │                          │  check email uniqueness   │                │
  │                          │──────────────────────────▶│                │
  │                          │                           │                │
  │                          │  bcrypt hash password     │                │
  │                          │  (cost 10)                │                │
  │                          │                           │                │
  │                          │  User.create()            │                │
  │                          │──────────────────────────▶│                │
  │                          │                           │                │
  │                          │  audit log (create)       │                │
  │                          │──────────────────────────▶│                │
  │                          │                           │                │
  │                          │  emit user.created ───────────────────────▶│
  │                          │                           │                │
  │  201 { user }            │                           │                │
  │◀─────────────────────────│                           │                │
```

- New users start with `roles: []`, `isActivated: true`.
- No default role auto-assignment.
- No email verification step — user is immediately active.
- No JWT returned on register — client must login separately.

### Login

```
Client                    Service                     MongoDB         Redis
  │                          │                           │              │
  │  POST /auth/login        │                           │              │
  │─────────────────────────▶│                           │              │
  │                          │                           │              │
  │                          │  find user by email       │              │
  │                          │  (+password, +failedLogin │              │
  │                          │   Attempts, +lastFailed)  │              │
  │                          │──────────────────────────▶│              │
  │                          │                           │              │
  │                          │  check blocking window    │              │
  │                          │  (≥5 failures in 5 min?)  │              │
  │                          │                           │              │
  │                          │  bcrypt.compare()         │              │
  │                          │                           │              │
  │                          │  [if wrong] increment     │              │
  │                          │  failedLoginAttempts      │              │
  │                          │──────────────────────────▶│              │
  │                          │                           │              │
  │                          │  [if correct] reset       │              │
  │                          │  failedLoginAttempts = 0  │              │
  │                          │──────────────────────────▶│              │
  │                          │                           │              │
  │                          │  sign JWT { id }          │              │
  │                          │                           │              │
  │  200 { user, token }     │                           │              │
  │◀─────────────────────────│                           │              │
```

### Token Validation (on every protected request)

```
authenticate middleware        user-service (internal)       Redis Cache
  │                                  │                          │
  │  verify JWT signature            │                          │
  │  extract { id }                  │                          │
  │                                  │                          │
  │  GET /internal/v1/users/:id/     │                          │
  │  auth-status                     │                          │
  │  (via cacheWrapDedup, TTL 5min)  │                          │
  │─────────────────────────────────▶│                          │
  │  { isActivated, passwordChangedAt }                         │
  │◀─────────────────────────────────│                          │
  │                                  │                          │
  │  reject if !isActivated          │                          │
  │  reject if token.iat < passwordChangedAt                    │
  │                                  │                          │
  │  set req.user = { id }           │                          │
  │                                  │                          │

  │  set req.user.roles, permissions, │                          │
  │  workCenterIds from auth context │                          │
  │  set req.user.permissions        │                          │
  │                                  │                          │
  │  [on failure: silently set       │                          │
  │   empty arrays, call next()]     │                          │
```

---

## Login Blocking (Brute Force Protection)

### Configuration

| Param | Default | Env Var |
|-------|---------|---------|
| Max attempts | 5 | `LOGIN_MAX_ATTEMPTS` |
| Blocking window | 5 minutes | `LOGIN_BLOCKING_DURATION_MS` |

### State Machine

```
              login attempt
                   │
                   ▼
         ┌─────────────────┐
         │ Check blocking  │
         │ window active?  │
         └────────┬────────┘
                  │
          ┌───────┴───────┐
          │               │
     Window active    Window inactive
     & attempts ≥ 5   or attempts < 5
          │               │
          ▼               ▼
    429 LOCKED      Try password
                         │
                  ┌──────┴──────┐
                  │             │
             Correct        Wrong
                  │             │
                  ▼             ▼
           Reset to 0    Increment
           200 OK        counter
                              │
                         Window expired?
                         ┌────┴────┐
                         │         │
                        Yes       No
                         │         │
                    Reset to 1   count++
                    (new window)
```

### Sliding Window Reset

When a failed login arrives after the blocking window has expired:
- Counter resets to 1 (not incremented from old value)
- A new window starts from `now`
- This prevents permanent lockout from historical failures

### Important: `findByIdAndUpdate` vs `findOneAndUpdate`

Failed login counter updates use `findByIdAndUpdate` with `$set` — this does **not** trigger the audit log plugin (which hooks `findOneAndUpdate`). This is intentional: login attempts are security metadata, not business data mutations.

---

## User Lifecycle

### Create

| Via | Required Fields | Optional Fields | Auth | Permission |
|-----|-----------------|-----------------|------|------------|
| Register | username, name, surname, email, password | — | none | none |
| Admin Create | username, name, surname, email, password | all admin fields | JWT | `createUsers` |

**Side effects on create:**
1. Password bcrypt-hashed (cost 10)
2. `User.create()` → Mongoose save
3. Audit log entry: `operation: 'create'`
4. Event: `user.created` → `events.user` stream

### Update

| Via | Allowed Fields | Auth | Permission |
|-----|---------------|------|------------|
| Self (PATCH /me) | name, surname, email, username, gender, countryCode, birthDate, language, defaultDashboardId | JWT | none |
| Admin (PATCH /:id) | all self fields + personalNumber, isActivated, isActiveDirectoryUser, departmentId, workCenterIds, specialities, roles, props | JWT | `writeUsers` |

**Side effects on update:**
1. Email uniqueness check (409 on conflict)
2. `Object.assign(user, data); user.save()`
3. Audit log entry: `operation: 'create'` (known behavior — uses `save()`)
4. Cache invalidation (conditional — see [Cache Rules](#cache-invalidation-rules))
5. Event: `user.updated` → `events.user` stream

### Delete

| Via | Auth | Permission |
|-----|------|------------|
| Self (DELETE /me) | JWT | none |
| Admin (DELETE /:id) | JWT | `deleteUsers` |

**Hard delete** — document permanently removed from MongoDB.

**Side effects on delete:**
1. `findByIdAndDelete()` → audit log: `operation: 'delete'`
2. Auth cache invalidated (scope `all`)
3. Event: `user.deleted` → `events.user` stream
4. Avatar file on disk: **NOT deleted**

### Password Reset (Admin)

```
POST /users/:id/reset-password   (permission: writeUsers)
```

**Side effects:**
1. New password bcrypt-hashed
2. `passwordChangedAt = new Date()` → all existing JWTs invalidated
3. `failedLoginAttempts = 0`, `lastFailedLoginAt = null`
4. Auth cache invalidated (scope `status`)
5. **No event emitted**
6. Audit log: `operation: 'create'` (via `save()`)

---

## Role Lifecycle

### Create

```typescript
createRole({ name, description?, permissions, isDefault? })
```

1. Name uniqueness check (409 `role.name_in_use`)
2. `Role.create()` → audit log
3. Event: `role.created` → `events.user` stream

### Update

```typescript
updateRole(id, { name?, description?, permissions?, isDefault? })
```

1. Name uniqueness check excludes self
2. `findByIdAndUpdate` with `{ new: true, runValidators: true }` → audit log (update)
3. **If permissions changed**: find all users with this role → bulk cache invalidation (scope `context`)
4. Event: `role.updated`

### Delete

```typescript
deleteRole(id)
```

**Cascade behavior:**

```
Role deleted
    │
    ├─ 1. Role.findByIdAndDelete() ──▶ audit log (delete)
    │
    ├─ 2. User.updateMany(
    │        { roles: id },
    │        { $pull: { roles: id } }
    │      )
    │      ──▶ removes role from ALL users
    │
    ├─ 3. invalidateAuthCacheMany(
    │        affectedUserIds, 'context'
    │      )
    │
    └─ 4. Event: role.deleted
```

**No transaction**: Steps 1-4 are not atomic. If step 2 fails after step 1 succeeds, users retain a dangling ObjectId in their `roles` array.

---

## Speciality Lifecycle

### Create / Update

Same pattern as Role — name uniqueness check, audit log, event emit.

### Delete

```typescript
deleteSpeciality(id)
```

1. `Speciality.findByIdAndDelete()` → audit log
2. Event: `speciality.deleted`
3. **No cascade** — users' `specialities[]` arrays are NOT cleaned up

**Orphan risk**: After deletion, users retain the deleted speciality's ObjectId in their `specialities` array. No cleanup handler exists (unlike Role delete which does `$pull`).

---

## Cache Invalidation Rules

### When Cache Is Invalidated

| Operation | Condition | Scope | Effect |
|-----------|-----------|-------|--------|
| Update user | `roles` changed | `context` | Clears `auth:context:<userId>` |
| Update user | `isActivated` changed | `status` | Clears `auth:status:<userId>` |
| Update user | both changed | `all` | Clears both keys |
| Update user | neither changed | — | No invalidation |
| Delete user | always | `all` | Clears both keys |
| Reset password | always | `status` | Clears `auth:status:<userId>` |
| Update role perms | always | `context` | Clears for ALL users with this role |
| Delete role | always | `context` | Clears for ALL affected users |

### Cache Key Structure

```
user:auth:status:<userId>    → { isActivated, passwordChangedAt }
user:auth:context:<userId>   → { roles, permissions }
```

Key prefix `user:` comes from `redisClient` configuration. TTL: 5 minutes (from `cacheWrapDedup`).

### Singleflight Deduplication

`cacheWrapDedup` ensures that concurrent requests for the same cache key during a cache miss result in only one internal HTTP call. Subsequent concurrent callers share the result of the first call.

---

## Event Publishing

All events published to stream: **`events.user`**

### Published Events

| Event Type | Trigger | Payload |
|------------|---------|---------|
| `user.created` | `registerUser`, `adminCreateUser` | `{ userId, traceId }` |
| `user.updated` | `updateUser`, `adminUpdateUser` | `{ userId, traceId }` |
| `user.deleted` | `deleteUser` | `{ userId, traceId }` |
| `role.created` | `createRole` | `{ roleId, traceId }` |
| `role.updated` | `updateRole` | `{ roleId, traceId }` |
| `role.deleted` | `deleteRole` | `{ roleId, traceId }` |
| `speciality.created` | `createSpeciality` | `{ specialityId, traceId }` |
| `speciality.updated` | `updateSpeciality` | `{ specialityId, traceId }` |
| `speciality.deleted` | `deleteSpeciality` | `{ specialityId, traceId }` |

### Operations That Do NOT Emit Events

- `updateAvatar` — no event
- `adminResetPassword` — no event
- Login/logout — no event
- Failed login recording — no event

### Publishing Semantics

- **Fire-and-forget**: wrapped in try/catch, failures logged at `warn` but never propagate
- **traceId**: injected from AsyncLocalStorage `getTraceId()`
- **MAXLEN**: stream trimmed automatically by `@mes/events` XADD wrapper
- **After DB write**: events always published AFTER the database operation succeeds

---

## Event Consumption

### Consumed Stream: `events.station`

| Event Type | Handler | Behavior |
|------------|---------|----------|
| `department.deleted` | `departmentDeletedHandler` | `User.updateMany({ departmentId: oid }, { $set: { departmentId: null } })` |

### Consumer Configuration

```typescript
{
  stream: 'events.station',
  group: 'user-service',
  consumer: `user-${process.pid}`
}
```

- Non-blocking XREADGROUP poll loop
- Auto-ACK on successful processing
- Pending message recovery on startup
- `traceId` propagation: extracted from event data → ALS via `runInContext`
- Consumer crash: logged at `error` (`events.consumer.crashed`), does not crash the process

---

## Cascading Behaviors

### Summary Matrix

| Entity Deleted | Cascade to Users | Mechanism | Transaction? |
|---------------|-----------------|-----------|--------------|
| Role | `$pull` from `roles[]` | Service-level | No |
| Speciality | **None** | — | — |
| Department | `$set: { departmentId: null }` | Redis Streams event | No |
| Station | Expected via event | Not yet implemented? | — |
| Dashboard | **None** | — | — |
| User | Auth cache cleared | Service-level | No |

### Data Integrity Risks

1. **Role delete without transaction**: if `User.updateMany` fails after `Role.findByIdAndDelete`, users retain a dangling role ObjectId.

2. **Speciality delete — no cascade**: deleted speciality IDs remain in users' `specialities[]` arrays indefinitely.

3. **User delete — orphaned avatar**: the avatar file on disk is not deleted when a user is hard-deleted. Only `updateAvatar` deletes the old file.

---

## Audit Logging

### What Is Audited

| Model | Create | Update | Delete |
|-------|--------|--------|--------|
| User | via `save()` | via `save()` or `findOneAndUpdate` | via `findOneAndDelete` |
| Role | via `save()` | via `findOneAndUpdate` | via `findOneAndDelete` |
| Speciality | via `save()` | via `findOneAndUpdate` | via `findOneAndDelete` |
| AuditLog | **not audited** | — | — |

### What Is NOT Audited

- Login attempts (success/failure)
- Cache invalidation events
- Event publishing
- Avatar file operations
- Failed login counter updates (`findByIdAndUpdate` — not hooked)

### Audit Entry Fields

```typescript
{
  timestamp:        Date,          // when
  operation:        'create' | 'update' | 'delete',
  model:            string,        // 'User', 'Role', 'Speciality'
  documentId:       string,        // affected document _id
  userId:           string,        // who (from ALS or SYSTEM_IDENTITY)
  ip:               string,        // client IP
  traceId:          string,        // distributed trace ID
  document:         object | null, // post-operation snapshot
  previousDocument: object | null  // pre-operation snapshot (updates only)
}
```

### Known Behavior: `save()` Logged as `create`

The `post('save')` hook fires on ALL `save()` calls — both initial creation and subsequent updates via `Object.assign(user, data); user.save()`.

**Operations that produce `operation: 'create'` when they should be `'update'`:**
- `updateUser` (self-update via PATCH /me)
- `adminUpdateUser` (admin update via PATCH /:id)
- `updateAvatar`
- `adminResetPassword`

**Operations that correctly produce `operation: 'update'`:**
- `updateRole` (uses `findByIdAndUpdate`)
- `updateSpeciality` (uses `findByIdAndUpdate`)

---

## Permission Enforcement

### Enforcement Points

```
Route definition
    │
    ├── requirePermission(code)    ← middleware, before controller
    │     ├── checks req.user.permissions.includes(code)
    │     ├── permissions ['*'] always passes (system identity)
    │     └── returns 403 inline (bypasses error handler)
    │
    └── Controller / Service       ← no further permission checks
          └── operates on any valid data
```

### No Object-Level Authorization

There is no check like "can this admin modify this specific user?" — if you have `writeUsers` permission, you can modify any user (including other admins). The only field-level restriction is Zod schema separation (self vs admin schemas).

### Permission Code → Route Mapping

| Code | Routes |
|------|--------|
| `readUsers` | GET /users, GET /users/:id, GET /users/by-*, GET /users/languages, GET /users/custom-field-keys, GET /users/check-dependencies |
| `writeUsers` | PATCH /users/:id, POST /users/:id/reset-password |
| `createUsers` | POST /users |
| `deleteUsers` | DELETE /users/:id |
| `readRoles` | GET /roles, GET /roles/:id, GET /roles/available-permissions |
| `writeRoles` | PATCH /roles/:id |
| `createRoles` | POST /roles |
| `deleteRoles` | DELETE /roles/:id |
| `readSpecialities` | GET /specialities, GET /specialities/:id |
| `writeSpecialities` | PATCH /specialities/:id |
| `createSpecialities` | POST /specialities |
| `deleteSpecialities` | DELETE /specialities/:id |

---

## Self vs Admin Field Access

### Fields Editable by Self (PATCH /me)

| Field | Validation |
|-------|-----------|
| name | trim, 2-24 chars |
| surname | trim, min 1 |
| email | valid email, uniqueness checked |
| username | trim, lowercase, 3-30, alphanumeric + `._-` |
| gender | enum: male, female, other |
| countryCode | free-form string |
| birthDate | coerced to Date |
| language | enum: en, tr |
| defaultDashboardId | ObjectId or null |

### Additional Fields for Admin (PATCH /:id)

| Field | Validation |
|-------|-----------|
| personalNumber | string or null |
| isActiveDirectoryUser | boolean |
| isActivated | boolean |
| departmentId | ObjectId or null |
| workCenterIds | ObjectId[] (default []) |
| specialities | ObjectId[] (default []) |
| roles | ObjectId[] (default []) |
| props | Record\<string, string\> |

### Fields Not Editable by Anyone via API

| Field | Managed By |
|-------|-----------|
| password | Register and admin reset only |
| passwordChangedAt | Set automatically on password change |
| failedLoginAttempts | Login flow only |
| lastFailedLoginAt | Login flow only |
| photoUrl | Avatar upload endpoint only |
| createdAt | Mongoose auto |
| updatedAt | Mongoose auto |

---

## File Upload Behavior

### Avatar Upload (PATCH /users/me/avatar)

```
                    Multer
                      │
                      ├── Storage: diskStorage
                      │     ├── destination: 'uploads/'
                      │     └── filename: UUID + original extension
                      │
                      ├── Filter: image/* MIME only
                      │     └── non-image → Error('upload.only_images')
                      │
                      └── Limits: 5 MB max
```

### Old File Cleanup

- On avatar update: previous file deleted from disk (best-effort)
- Exception: default Node.js logo path is never deleted
- On user delete: avatar file is **NOT** deleted
- On failed upload: no cleanup needed (multer doesn't write on filter rejection)

### Serving

Static files served via `express.static('uploads')`. Avatar URLs stored as `/uploads/<filename>` in `user.photoUrl`.

---

## Cross-Service Dependencies

### Outbound (user-service → other services)

| Dependency | Direction | Mechanism |
|-----------|-----------|-----------|
| `events.user` stream | publish | XADD via `@mes/events` |
| `checkUserDependencies` | expose | HTTP endpoint for other services |

### Inbound (other services → user-service)

| Dependency | Direction | Mechanism |
|-----------|-----------|-----------|
| `events.station` stream | consume | XREADGROUP via `@mes/events` |
| `department.deleted` event | handle | Nullify `departmentId` on affected users |
| Auth verification | internal HTTP | `/internal/v1/users/:id/auth-status` |
| Permission resolution | internal HTTP | `/internal/v1/users/:id/roles-permissions` |

### Self-Loop

`@mes/auth` middleware (running inside user-service) calls `/internal/v1/users/:id/auth-status` and `/internal/v1/users/:id/roles-permissions` on the **same** service instance. The internal router injects `permissions: ['*']` synthetically, bypassing JWT verification. This self-loop is wrapped with `cacheWrapDedup` (Redis cache, TTL 5 min, singleflight) to prevent performance degradation.

---

## Edge Cases & Known Behaviors

### 1. Audit Log `save()` Operation Mismatch

**What**: `post('save')` hook always logs `operation: 'create'`, even when the document is being updated via `Object.assign + save()`.

**Impact**: Audit logs for user self-updates, admin updates, avatar changes, and password resets show `operation: 'create'` instead of `'update'`. The `previousDocument` field is `null` for these entries.

**Workaround**: Query audit logs for a given `documentId` sorted by `timestamp` — the first entry is the real create, subsequent entries are updates regardless of the `operation` field.

### 2. Multer Error Classification

**What**: Non-image file upload throws `Error('upload.only_images')` — a plain Error, not a CustomError.

**Impact**: Falls through to the generic 500 handler in production. The i18n key `upload.only_images` appears as the raw message rather than a translated string.

### 3. `requirePermission` Bypasses i18n

**What**: The 403 response sends the literal key `'auth.insufficient_permissions'` via `res.json()` inline, not through the error handler.

**Impact**: The message is not translated — clients always receive the English key regardless of `Accept-Language`.

### 4. Speciality Deletion — No User Cleanup

**What**: Unlike Role deletion (which does `$pull` on all users), Speciality deletion performs no cascade.

**Impact**: Users retain deleted speciality ObjectIds in their `specialities[]` array. These are "ghost" references — they don't resolve to anything but don't cause errors either.

### 5. Avatar Orphaning on User Delete

**What**: `deleteUser` does not remove the user's avatar file from disk.

**Impact**: Orphaned image files accumulate in `uploads/`. Only `updateAvatar` deletes old files. On an on-premises system with limited SSD (512GB-1TB), this could eventually matter.

### 7. Self-Delete by Authenticated User

**What**: `DELETE /users/me` allows any authenticated user to permanently delete their own account.

**Impact**: Hard delete — no recovery. Auth cache is invalidated so the token becomes useless immediately. No confirmation step in the API.

### 8. Registration Without Role Assignment

**What**: New users via `POST /auth/register` get `roles: []` — no default role.

**Impact**: After registration, the user can authenticate but has zero permissions. They can only access "me" endpoints. An admin must assign roles for the user to do anything useful.

### 9. No Transaction on Role Delete Cascade

**What**: Role deletion and the subsequent `User.updateMany($pull)` are not in a MongoDB transaction.

**Impact**: If the user update fails after the role is already deleted, users retain dangling ObjectIds. On next role population, these IDs simply won't resolve — functionally harmless but semantically incorrect.

### 10. `USER_DELETION_RETENTION_DAYS` Defined But Unused

**What**: Config defines `USER_DELETION_RETENTION_DAYS` (default 30, transformed to `USER_DELETION_RETENTION_MS`), but no service logic references it.

**Impact**: Currently dead code. Likely intended for future soft-delete or retention policy implementation.

### 11. Password Not Validated on Self-Update

**What**: `updateMeSchema` and `adminUpdateUserSchema` do not include a `password` field. Password can only be changed via an admin reset.

**Impact**: Users cannot change their own password via the profile update endpoint. This may be intentional (passwords change through an admin reset) or an oversight.

### 12. `isDefault` on Role — No Auto-Assignment

**What**: The `isDefault` field on Role has no service-level logic — it's stored but never used for auto-assigning roles to new users.

**Impact**: It's a UI hint only. Frontend can display it, but the backend doesn't act on it. New users via register or admin create must have roles explicitly set.
