# User Service — API Contract

> Generated from deep code review. Last updated: 2026-03-22.

---

## Table of Contents

- [Global Conventions](#global-conventions)
- [Auth: Register](#post-apiv1authregister)
- [Auth: Login](#post-apiv1authlogin)
- [Password Recovery](#password-recovery)
- [Users: Self ("Me")](#users-self-me)
- [Users: Admin](#users-admin)
- [Users: Lookup](#users-lookup)
- [Roles](#roles)
- [Specialities](#specialities)
- [Internal Routes](#internal-routes)
- [Privilege Registry](#privilege-registry)
- [Error Reference](#error-reference)

---

## Global Conventions

### Base URL

```
/api/v1      — external (JWT-authenticated)
/internal/v1 — service-to-service (gateway-blocked, no JWT)
```

### Response Envelope

**Success:**

```json
{
  "success": true,
  "message": "translated string",
  "data": "<T>"
}
```

**Paginated Success:**

```json
{
  "success": true,
  "message": "translated string",
  "data": ["<T>", "..."],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 142,
    "totalPages": 8
  }
}
```

**Error:**

```json
{
  "success": false,
  "message": "translated string",
  "errors": [
    { "field": "email", "message": "Invalid email" }
  ]
}
```

- `errors[]` only present on validation failures (400).
- `stack` included in development mode only (5xx).
- `message` is i18n-translated via `Accept-Language` header (`en`, `tr`). Fallback: `en`.

### Authentication

- `Authorization: Bearer <jwt>` header required on all protected routes.
- JWT payload: `{ id: string }`. Signed with `JWT_SECRET`, expires per `JWT_EXPIRES_IN` (default `1d`).
- Token rejected if issued before user's `passwordChangedAt` timestamp.
- Token rejected if user's `isActivated === false`.

### Language Detection

Priority order:
1. `Accept-Language` header
2. `?lng=` query parameter
3. Cookie

Supported: `en`, `tr`.

### ObjectId Validation

All `:id` path parameters and ObjectId body fields are validated with `z.string().refine(Types.ObjectId.isValid)`. Invalid format returns `400` with message key `error.invalid_id`.

---

## POST /api/v1/auth/register

Creates a new user account. Public — no auth required.

| | |
|---|---|
| **Auth** | None |
| **Permission** | None |
| **Status** | `201 Created` |

### Request Body

```typescript
{
  username:  string  // required, trim, lowercase, 3-30 chars, /^[a-z0-9._-]+$/
  name:      string  // required, trim, 2-24 chars
  surname:   string  // required, trim, min 1
  email:     string  // required, valid email format
  password:  string  // required, 8-20 chars
}
```

Schema: `registerSchema` — `.strict()` (no extra fields).

### Response `201`

```json
{
  "success": true,
  "message": "success.register",
  "data": { "<UserResponse>" }
}
```

### Errors

| Status | Key | When |
|--------|-----|------|
| 400 | `ZodError` | Validation failure |
| 409 | `user.email_in_use` | Email already exists |
| 409 | MongoDB 11000 | Username already exists |

---

## POST /api/v1/auth/login

Authenticates a user and returns a JWT token.

| | |
|---|---|
| **Auth** | None |
| **Permission** | None |
| **Status** | `200 OK` |

### Request Body

```typescript
{
  email:    string  // required, valid email
  password: string  // required, min 1 char (no policy enforcement)
}
```

Schema: `loginSchema` — not `.strict()`.

### Response `200`

```json
{
  "success": true,
  "message": "success.login",
  "data": {
    "user": { "<UserResponse>" },
    "token": "eyJhbGciOiJI..."
  }
}
```

### Errors

| Status | Key | When |
|--------|-----|------|
| 400 | `ZodError` | Validation failure |
| 401 | `auth.invalid_credentials` | Wrong email or password |
| 429 | `auth.account_temporarily_locked` | Too many failed attempts (5 within 5 min) |

The 429 response includes `remainingSeconds` in the error data.

### Rate Limiting (Login Blocking)

- Max attempts: `LOGIN_MAX_ATTEMPTS` (default 5)
- Blocking window: `LOGIN_BLOCKING_DURATION_MS` (default 300000ms = 5 min)
- Sliding window: if blocking period expires, counter resets on next failure
- Successful login resets counter to 0

---

## Password Recovery

All public — no auth required.

### POST /api/v1/password-recoveries

Request a recovery code. Code is delivered out-of-band (email/SMS).

| | |
|---|---|
| **Auth** | None |
| **Status** | `200 OK` |

```typescript
// Request
{ email: string }  // valid email

// Response
{
  "success": true,
  "message": "success.verify",
  "data": { "email": "user@example.com", "expiredAt": "2026-03-17T12:02:00Z" }
}
```

- Rate limit: 5 requests per hour per user. Exceeding returns generic success (no error — prevents user enumeration).
- Non-existent email returns generic success (prevents user enumeration).
- Code: 5-digit numeric (10000-99999), bcrypt-hashed.
- TTL: 2 minutes. MongoDB TTL index auto-deletes expired records.
- Previous active codes for the same user are invalidated on new request.

### POST /api/v1/password-recoveries/verify

Verify a recovery code without changing password.

```typescript
// Request
{
  email: string   // valid email
  code:  number   // integer, 10000-99999
}

// Response — same shape as request endpoint
```

| Status | Key | When |
|--------|-----|------|
| 400 | `password_recovery.invalid_or_expired_code` | No matching active code |

### POST /api/v1/password-recoveries/verify-and-reset

Verify code and set new password in one step.

```typescript
// Request
{
  email:       string  // valid email
  code:        number  // integer, 10000-99999
  newPassword: string  // min 1 char
}
```

- Changes password, sets `passwordChangedAt`, resets failed login counters.
- Marks recovery code as used.
- Invalidates auth cache — existing JWTs become invalid.

---

## Users: Self ("Me")

All require authentication. No specific permission required — any authenticated user can access their own data.

### GET /api/v1/users/me

Returns the authenticated user's profile.

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | None (self) |
| **Status** | `200 OK` |

Response: `SuccessResponse<UserResponse>`

### PATCH /api/v1/users/me

Update own profile. Only user-editable fields accepted.

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | None (self) |
| **Status** | `200 OK` |

```typescript
// Request — all fields optional
{
  name:               string   // trim, 2-24 chars
  surname:            string   // trim, min 1
  email:              string   // valid email
  username:           string   // trim, lowercase, 3-30, /^[a-z0-9._-]+$/
  gender:             'male' | 'female' | 'other'
  countryCode:        string
  birthDate:          Date     // z.coerce.date()
  language:           'en' | 'tr'
  defaultDashboardId: ObjectId | null
}
```

Schema: `updateMeSchema` — `.strict()`. Fields NOT available for self-update: `roles`, `isActivated`, `departmentId`, `workCenterIds`, `specialities`, `personalNumber`, `props`, `isActiveDirectoryUser`.

| Status | Key | When |
|--------|-----|------|
| 409 | `user.email_in_use` | Email taken by another user |

### PATCH /api/v1/users/me/avatar

Upload profile photo. Multipart form data.

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | None (self) |
| **Status** | `200 OK` |

- Field name: `photo`
- Accepts: `image/*` MIME types only
- Max size: 5 MB
- Storage: `uploads/` directory, UUID filename, original extension preserved
- Previous avatar file deleted from disk on update (best-effort)

| Status | Key | When |
|--------|-----|------|
| 400 | `user.avatar_required` | No file in request |
| 500 | `upload.only_images` | Non-image file type |

### DELETE /api/v1/users/me

Delete own account. **Hard delete** — irreversible.

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | None (self) |
| **Status** | `200 OK` |

---

## Users: Admin

All require authentication + specific permission.

### POST /api/v1/users

Create a user with admin-level fields.

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | `createUsers` |
| **Status** | `201 Created` |

```typescript
// Request — register fields required, admin fields optional
{
  // Required (from registerSchema)
  username:  string
  name:      string
  surname:   string
  email:     string
  password:  string   // 8-20 chars

  // Optional (admin-only fields)
  gender:                'male' | 'female' | 'other'
  countryCode:           string
  birthDate:             Date
  language:              'en' | 'tr'
  defaultDashboardId:    ObjectId | null
  personalNumber:        string | null
  isActiveDirectoryUser: boolean
  isActivated:           boolean
  departmentId:          ObjectId | null
  workCenterIds:         ObjectId[]       // default []
  specialities:          ObjectId[]       // default []
  roles:                 ObjectId[]       // default []
  props:                 Record<string, string>
}
```

Schema: `adminCreateUserSchema` — `.strict()`.

### PATCH /api/v1/users/:id

Update any user with admin-level fields.

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | `writeUsers` |
| **Status** | `200 OK` |

Request body: same as `adminCreateUserSchema` but all fields optional (`adminUpdateUserSchema`).

Path: `validateParams(userIdParamSchema)` — `:id` must be valid ObjectId.

### DELETE /api/v1/users/:id

Delete any user. **Hard delete.**

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | `deleteUsers` |
| **Status** | `200 OK` |

### POST /api/v1/users/:id/reset-password

Reset a user's password (admin action).

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | `writeUsers` |
| **Status** | `200 OK` |

```typescript
{ password: string }  // 8-20 chars
```

- Sets `passwordChangedAt` — invalidates all existing JWTs for the user.
- Resets failed login counters.
- Does NOT emit event.

---

## Users: Lookup

All require `readUsers` permission.

### GET /api/v1/users

List users with pagination, filtering, sorting, and search.

| | |
|---|---|
| **Auth** | Bearer token |
| **Permission** | `readUsers` |
| **Status** | `200 OK` |

```typescript
// Query Parameters
{
  page:         number   // min 1, default 1
  limit:        number   // min 1, max 100, default 20
  sort:         string   // comma-separated, prefix '-' for desc (e.g. "-createdAt,name")
  search:       string   // max 100, searches: name, surname, username, email (case-insensitive)
  isActivated:  'true' | 'false'   // transformed to boolean filter
  departmentId: ObjectId           // exact match filter
  roles:        ObjectId           // single role filter
}
```

**Allowed sort fields:** `name`, `surname`, `username`, `email`, `createdAt`, `updatedAt`, `isActivated`.
Default sort: `createdAt` descending.

Response: `PaginatedResult<UserResponse>` with `roleNames` virtual populated.

### GET /api/v1/users/:id

| **Permission** | `readUsers` |
|---|---|

Response: `SuccessResponse<UserResponse>`

### GET /api/v1/users/by-username/:username

| **Permission** | `readUsers` |
|---|---|

Param: `username: z.string()`

### GET /api/v1/users/by-email/:email

| **Permission** | `readUsers` |
|---|---|

Param: `email: z.email()`

### GET /api/v1/users/:id/roles

| **Permission** | `readUsers` |
|---|---|

Returns user with `roleNames` populated (role objects with `id`, `name`, `description`).

### GET /api/v1/users/:id/roles-permissions

Returns roles and flattened permissions for a user. Used internally by `@mes/auth`.

| **Permission** | `readUsers` |
|---|---|

```json
{
  "success": true,
  "data": {
    "roles": ["roleId1", "roleId2"],
    "permissions": ["readUsers", "writeUsers", "..."]
  }
}
```

### GET /api/v1/users/:id/auth-status

Returns activation and password change status. Used internally by `@mes/auth`.

| **Permission** | `readUsers` |
|---|---|

```json
{
  "success": true,
  "data": {
    "isActivated": true,
    "passwordChangedAt": "2026-03-15T10:00:00Z"
  }
}
```

### GET /api/v1/users/languages

Returns all supported languages.

| **Permission** | `readUsers` |
|---|---|

Response: `SuccessResponse<string[]>` — currently `['tr', 'en']` (hardcoded).

### GET /api/v1/users/custom-field-keys

Returns all distinct keys used in user `props` maps across the database.

| **Permission** | `readUsers` |
|---|---|

Response: `SuccessResponse<string[]>`

### GET /api/v1/users/check-dependencies

Check if a field value is in use by any user.

| **Permission** | `readUsers` |
|---|---|

```typescript
// Query
{
  fieldName:  'departmentId' | 'workCenterIds'
  fieldValue: string   // ObjectId as string
}

// Response
{ "success": true, "data": { "inUse": true } }
```

---

## Roles

### GET /api/v1/roles

| **Permission** | `readRoles` |
|---|---|

Response: `SuccessResponse<IRole[]>` — no pagination, returns all roles.

### GET /api/v1/roles/available-permissions

| **Permission** | `readRoles` |
|---|---|

Returns the full privilege registry. Response: `SuccessResponse<Privilege[]>` where each privilege has `code` and `text`.

### GET /api/v1/roles/:id

| **Permission** | `readRoles` |
|---|---|

### POST /api/v1/roles

| **Permission** | `createRoles` |
|---|---|
| **Status** | `201 Created` |

```typescript
{
  name:        string    // required, trim, 2-50 chars
  description: string    // optional
  permissions: string[]  // required, min 1, each validated against VALID_PRIVILEGE_CODES
  isDefault:   boolean   // default false
}
```

Schema: `createRoleSchema` — `.strict()`.

| Status | Key | When |
|--------|-----|------|
| 409 | `role.name_in_use` | Name already exists |

### PATCH /api/v1/roles/:id

| **Permission** | `writeRoles` |
|---|---|

Same body as create, all fields optional (`updateRoleSchema`).

- If `permissions` changes: all users with this role get their auth cache invalidated.

### DELETE /api/v1/roles/:id

| **Permission** | `deleteRoles` |
|---|---|

- Cascade: role pulled from all users' `roles` arrays.
- All affected users' auth cache invalidated.

---

## Specialities

### GET /api/v1/specialities

| **Permission** | `readSpecialities` |
|---|---|

Response: `SuccessResponse<ISpeciality[]>` — no pagination.

### GET /api/v1/specialities/:id

| **Permission** | `readSpecialities` |
|---|---|

### POST /api/v1/specialities

| **Permission** | `createSpecialities` |
|---|---|
| **Status** | `201 Created` |

```typescript
{
  name:        string  // required, trim, 2-100 chars
  description: string  // optional
}
```

### PATCH /api/v1/specialities/:id

| **Permission** | `writeSpecialities` |
|---|---|

### DELETE /api/v1/specialities/:id

| **Permission** | `deleteSpecialities` |
|---|---|

**No cascade** — users retain deleted speciality ObjectIds as orphaned references.

---

## Internal Routes

Prefix: `/internal/v1`. Same route handlers as `/api/v1`.

No JWT required — `req.user` is synthetically set:

```typescript
req.user = {
  id: 'ffffffffffffffffffffffff',  // SYSTEM_IDENTITY
  roles: [],
  permissions: ['*']               // wildcard — all permissions pass
}
```

Access restricted at the network level by Traefik gateway (internal routes are not exposed externally).

---

## Privilege Registry

### Users

| Code | Purpose |
|------|---------|
| `readUsers` | View user list and details |
| `writeUsers` | Edit users, reset passwords |
| `createUsers` | Create new users |
| `deleteUsers` | Delete users |
| `accessUsersScreen` | UI access to the users screen |

### Roles

| Code | Purpose |
|------|---------|
| `readRoles` | View roles and privileges |
| `writeRoles` | Edit roles |
| `createRoles` | Create new roles |
| `deleteRoles` | Delete roles |
| `accessRolesScreen` | UI access to the roles screen |

### Specialities

| Code | Purpose |
|------|---------|
| `readSpecialities` | View specialities |
| `writeSpecialities` | Edit specialities |
| `createSpecialities` | Create new specialities |
| `deleteSpecialities` | Delete specialities |
| `accessSpecialitiesScreen` | UI access to the specialities screen |

### Password Policy

| Code | Purpose |
|------|---------|
| `readPasswordPolicy` | View password policy |
| `writePasswordPolicy` | Edit password policy |

### Dashboards

| Code | Purpose |
|------|---------|
| `readDashboards` | View dashboards |
| `writeDashboards` | Edit dashboards |
| `createDashboards` | Create dashboards |
| `deleteDashboards` | Delete dashboards |
| `accessDashboardsScreen` | UI access to the dashboards screen |

### Settings

| Code | Purpose |
|------|---------|
| `writeSystemSettings` | Modify system settings |
| `accessSystemSettingsScreen` | UI access to the system settings screen |

### Logs

| Code | Purpose |
|------|---------|
| `accessAuditLogsScreen` | UI access to the audit logs screen |

### Departments

| Code | Purpose |
|------|---------|
| `readDepartments` | View departments |
| `writeDepartments` | Edit departments |
| `createDepartments` | Create departments |
| `deleteDepartments` | Delete departments |
| `accessDepartmentsScreen` | UI access to the departments screen |

---

## Error Reference

### HTTP Status Codes

| Code | Meaning | Logged? |
|------|---------|---------|
| 400 | Validation error (Zod), missing file, invalid code | No |
| 401 | Unauthenticated — missing/invalid/expired token | No |
| 403 | Insufficient permissions | No |
| 404 | Resource not found | No |
| 409 | Conflict — duplicate unique field | No |
| 429 | Account temporarily locked | No |
| 500 | Unexpected server error | Yes (with stack trace) |

### i18n Error Keys

| Key | Status | Context |
|-----|--------|---------|
| `auth.unauthenticated` | 401 | Missing or invalid JWT |
| `auth.invalid_credentials` | 401 | Wrong email/password |
| `auth.account_temporarily_locked` | 429 | Login brute force protection |
| `auth.insufficient_permissions` | 403 | Missing required permission |
| `user.email_in_use` | 409 | Email uniqueness conflict |
| `user.not_found` | 404 | User ID not in database |
| `user.avatar_required` | 400 | Avatar upload with no file |
| `role.name_in_use` | 409 | Role name uniqueness conflict |
| `role.not_found` | 404 | Role ID not in database |
| `speciality.not_found` | 404 | Speciality ID not in database |
| `speciality.name_in_use` | 409 | Speciality name uniqueness conflict |
| `password_recovery.invalid_or_expired_code` | 400 | Wrong or expired recovery code |
| `upload.only_images` | 500 | Non-image file uploaded |
| `error.invalid_id` | 400 | Invalid ObjectId format |

---

## UserResponse Shape

Returned by all user endpoints. Sensitive fields are excluded.

```typescript
{
  _id:                    string       // ObjectId
  username:               string
  email:                  string
  name:                   string
  surname:                string
  roles:                  string[]     // ObjectId[]
  gender:                 'male' | 'female' | 'other' | undefined
  countryCode:            string | undefined
  birthDate:              string | undefined     // ISO date
  photoUrl:               string | null
  language:               'en' | 'tr'
  personalNumber:         string | null
  departmentId:           string | null          // ObjectId
  workCenterIds:          string[]               // ObjectId[]
  specialities:           string[]               // ObjectId[]
  defaultDashboardId:     string | null          // ObjectId
  props:                  Record<string, string>
  isActivated:            boolean
  isActiveDirectoryUser:  boolean
  passwordChangedAt:      string | undefined     // ISO date
  createdAt:              string                 // ISO date
  updatedAt:              string                 // ISO date
  roleNames:              Role[] | undefined     // populated on demand
}
```

**Excluded fields** (never in response): `password`, `failedLoginAttempts`, `lastFailedLoginAt`.

### IRole Shape

```typescript
{
  _id:          string
  name:         string
  description:  string | null
  permissions:  string[]
  isDefault:    boolean
  createdAt:    string
  updatedAt:    string
}
```

### ISpeciality Shape

```typescript
{
  _id:          string
  name:         string
  description:  string | null
  createdAt:    string
  updatedAt:    string
}
```

---

## Middleware Chain (Request Lifecycle)

```
 Request
    │
    ├─ helmet (security headers)
    ├─ cors
    ├─ express.json()
    ├─ express.urlencoded({ extended: true })
    ├─ compression
    ├─ i18nextMiddleware (language detection)
    ├─ contextMiddleware (AsyncLocalStorage: traceId, userId, ip)
    ├─ httpLoggerMiddleware (prod) / morganMiddleware (dev)
    ├─ express.static('public')
    ├─ express.static('uploads')
    │
    ├─ [Public routes: /docs, /health, /ready, /auth/*, /password-recoveries/*]
    │
    ├─ authenticate (JWT verify + consolidated auth context)
    │
    ├─ [Per-route: requirePermission(code)]
    ├─ [Per-route: validateBody/Params/Query(schema)]
    │
    ├─ Controller → Service → Database
    │
    └─ errorHandler (global catch-all)
```
