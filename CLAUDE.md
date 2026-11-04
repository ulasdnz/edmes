# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

On-premises Manufacturing Execution System (MES). Deployed to customer factories with 512GB-1TB SSD, no cloud dependencies. The monorepo will grow to 8-10 microservices. Every decision must prioritize production reliability, maintainability, and simplicity over cleverness.

## AI Assistant Behavior

- **Always use Context7** to look up library/API documentation, code examples, setup steps, and configuration patterns — without the user having to ask. This applies to any library used in the project (Express, Mongoose, Winston, Zod, ioredis, Vitest, etc.).
- Review your own work like a senior engineer before presenting it. Catch issues proactively.
- Prefer simple, direct solutions. Do not over-engineer. Three similar lines are better than a premature abstraction.
- When creating new services, follow the patterns established in `user/` — same directory structure, same shared packages, same conventions.
- When modifying shared packages (`packages/*`), consider the impact on all consuming services.
- Do not add comments, docstrings, or type annotations to code you didn't change.

## Build & Run Commands

```bash
pnpm build                         # full build (packages + all services, via turbo)
pnpm build:packages                # shared packages only (tsc -b)
pnpm build:watch                   # watch mode for packages
pnpm build:clean                   # clean + full rebuild
pnpm dev                           # all services in dev mode (tsx watch)
pnpm --filter user-service dev     # one service in dev mode
pnpm typecheck                     # type check packages and services
pnpm lint                          # biome lint check
pnpm lint:fix                      # biome auto-fix + format
pnpm format                        # format only
pnpm test                          # all tests via turbo
pnpm --filter user-service test    # user service unit tests
pnpm test:contract                 # contract tests (user, work-center, production, performance, telemetry)
pnpm test:e2e                      # builds, then runs the services against real MongoDB, Redis and MQTT
cd user && pnpm test:watch         # watch mode
docker compose up -d --build       # full stack
docker compose up -d --build user  # rebuild user service only
```

## Architecture

**Monorepo**: pnpm workspaces + TypeScript project references + Turborepo.

### Package Dependency Graph

```
cache → (nothing)    core → (nothing)    openapi → (nothing)    events → (nothing)
auth → cache, core   logger → core       health → core
user-service → all packages above
testing → source-only (no build, vitest transpiles directly)
```

### Shared Packages (`packages/*`)

| Package | Purpose |
|---------|---------|
| `@mes/core` | Error classes, Express middleware (error handler, request context via AsyncLocalStorage, validation), shutdown helpers. `@mes/core/pagination`: list pagination for Mongoose models |
| `@mes/auth` | JWT authentication + RBAC permission middleware, Redis-backed cache with singleflight |
| `@mes/cache` | Redis client factory (shared connection settings), cache-aside pattern with singleflight dedup |
| `@mes/logger` | Winston logger (JSON in prod, colorized in dev), structured HTTP logger middleware, Morgan for dev |
| `@mes/events` | Redis Streams publish/consume with consumer groups, auto-ACK, pending recovery, traceId propagation |
| `@mes/health` | Health/readiness endpoints with dependency-injected probes |
| `@mes/openapi` | Zod-OpenAPI document generation |
| `@mes/privileges` | Central RBAC privilege registry shared by all services and system-admin bootstrap |
| `@mes/testing` | Shared test utilities (source-only, exports `src/index.ts` directly) |

### Service Apps

- `user/` — User, Role, Speciality CRUD + auth. Express 5, Mongoose 9, Zod 4.
- New services go in root directory (workspace configured). Follow `user/` structure exactly.

### Infrastructure

- **API Gateway**: Traefik (routing, rate limiting, compression)
- **Database**: MongoDB 9 (Mongoose 9)
- **Cache & Events**: Redis 7 (ioredis for cache, Redis Streams for cross-service events)
- **Observability**: Grafana + Loki + Alloy (centralized logging, <1GB RAM total)
- **i18n**: i18next with filesystem backend, HTTP middleware for per-request locale

### Cross-Service Communication

Redis Streams via `@mes/events`. Publisher injects `traceId` from ALS context into event data. Consumer extracts it and seeds ALS via `runInContext` — enables end-to-end distributed tracing across services.

Streams: `events.user` (published by user-service), `events.work_center` (consumed by user-service).

### Event Design

**Payload rule:** Events carry only the IDs needed for routing and identification — not full documents. Consumers fetch full state via REST if needed. This prevents stale-data issues and keeps event size minimal.

**Routing key rule (critical):** The `realtime` gateway routes events to Socket.io rooms based on `workCenterId`. When an update event can change a routing key field, the emit function MUST include both new and previous values so both the old and new room owners receive the event:

```typescript
// workCenterId changed: both rooms must be notified
emitJobOrderUpdated(jobOrderId, workCenterId, previousWorkCenterId?: string)
// payload: { jobOrderId, workCenterId, previousWorkCenterId }
```

- Only include `previousWorkCenterId` in the payload when the work center actually changed. If present, gateway emits to BOTH `workCenter:{workCenterId}` AND `workCenter:{previousWorkCenterId}` rooms.
- Currently `workCenterId` is the only routing key. If future entities introduce other routing keys (e.g. `departmentId`), the same `previous{Field}` convention applies.
- The service emitting the event always knows both old and new values at write time — do not rely on consumers fetching previous state.

## Adding a New Service

1. Create `<service-name>/` in the root following `user/` directory structure
2. Add `tsconfig.json` extending `../tsconfig.app.json` with references to needed packages
3. Add to `pnpm-workspace.yaml`
4. Add to root `tsconfig.json` references
5. Add Dockerfile following `user/Dockerfile` pattern (two-phase build)
6. Add service to `docker-compose.yml` with `image: ghcr.io/ulasdnz/edmes-<service>:${EDMES_VERSION:-dev}`, Traefik labels, healthcheck, and named volumes; put its `build` in `docker-compose.override.yml` and add it to the matrix in `.github/workflows/release.yml`
7. Create event stream `events.<service>` and register handlers in consuming services
8. Reuse shared packages — do not duplicate auth, cache, logging, error handling, or health check logic

## Key Conventions

### API Design

Standard REST: POST (create), PUT (full replace), PATCH (partial update), DELETE. No action-specific routes (if it is really needed) — state transitions and structural changes are field updates via PATCH; backend detects what changed and runs validation/side effects.

**Response format:**
- Success: `{ data }` for GETs, `{ data, message }` for mutations (POST/PATCH/DELETE). No `success` field.
- Error: `{ error: { code, message, details? } }` — `code` is the i18n key, `message` is the translated string, `details` is optional (validation errors).
- List endpoints: `{ data: [...], pagination: { page, limit, total, totalPages } }`.

**Population:** List endpoints do NOT auto-populate references. Clients opt-in via `?populate=roles` query param. Only whitelisted fields are supported per endpoint.

### Mongoose Models

- All Mongoose models must use `timestamps: true` (`createdAt`, `updatedAt` auto-managed).
- Models that are created or modified by authenticated users include `createdBy` and `updatedBy` fields (user `_id`). Internal/system operations use `SYSTEM_IDENTITY`. These actor fields (`createdBy`, `updatedBy`, `startedBy`, `endedBy`) must be `Schema.Types.ObjectId` without `ref` — not `String`. No `ref` because the User model lives in a different service (cross-service boundary, populate not applicable). When assigning from a string userId in `.save()` patterns, use `new Types.ObjectId(userId)`.
- Don't use `.lean()` on `findOneAndUpdate`/`findOneAndDelete` if the model uses `auditLogPlugin` — the post hooks call `doc.toObject()` which doesn't exist on lean results. `.lean()` on `find`/`findById` is fine (audit plugin doesn't hook those).
- `__v` is hidden from all API responses: `toObject`/`toJSON` transforms on models + `.select('-__v')` on `.lean()` queries (since lean bypasses transforms). New models must do both.
- Use `ref` on schema fields directly for population (`ref: 'Role'`), not Mongoose virtuals — virtuals + `.lean()` cause duplicate fields in responses.

### TypeScript / Imports

- All packages: `"type": "module"` + NodeNext — **imports MUST use `.js` extensions** (even for `.ts` source).
- Shared packages: `composite: true` for project references.
- Service apps: extend `tsconfig.app.json` (`composite: false`, `verbatimModuleSyntax`).

### Permissions (RBAC)

- `PRIVILEGES` in `@mes/privileges` is the **single source of truth** for all assignable permission codes. Every permission used in `requirePermission()` calls must exist there.
- When adding a new module or feature, add its permission codes to `@mes/privileges` **first**. The system admin role auto-syncs to include all `PRIVILEGES` on startup.
- Naming convention: camelCase verb+entity — `readEntity`, `writeEntity`, `createEntity`, `deleteEntity`, `accessEntityScreen`.
- `requirePermission('code')` from `@mes/auth` enforces permissions at route level; it checks string inclusion against the user's resolved permission array.
- `SYSTEM_IDENTITY` (`'ffffffffffffffffffffffff'`) gets wildcard `['*']` for internal service-to-service calls. Real users (including the bootstrapped system admin) receive explicit permission codes.
- The system admin role and user are protected from deletion and renaming via API guards.

### Date / Time

- Distinguish **instants** from **date-only business values**.
- Instants exchanged via APIs, MQTT, Redis events, historian queries, and cross-service payloads must use ISO 8601 UTC with a trailing `Z`.
- Canonical instant example: `2026-04-04T12:30:00.000Z`
- Reject offset-less or local datetime strings such as `2026-04-04T12:30:00` or `2026-04-04 12:30:00`.
- Keep the wire format canonical as `...Z`; do not rely on local server timezone or implicit offsets.
- Persist instants in MongoDB as `Date`, not strings.
- Convert timestamps to local timezone only in the frontend or explicit presentation layers.
- If a domain concept is truly date-only or plant-local (for example `birthDate` or `localDate`), model it explicitly as a date-only value instead of pretending it is a UTC instant.

### Logging

Every log call includes an `event` field using dot-notation (`domain.entity.action`):

```typescript
logger.info('Server started', { event: 'server.start', port: PORT })
logger.warn('Login failed', { event: 'user.login.failed', userId, attemptCount })
logger.error('Mongo connection failed', { event: 'db.mongo.connection_failed', error: err.message })
```

Rules:
- First arg is always the human-readable message string (Winston API requirement — passing an object produces `[object Object]`).
- Only 5xx errors are logged from the error handler. 4xx are NOT logged — the HTTP logger middleware already captures every request with `statusCode`.
- `debug` for verbose/startup details, `info` for operational milestones, `warn` for degraded state, `error` for failures requiring attention.
- Never use `console.log/warn/error` — always use the Winston logger.
- Log `req.route?.path` (pattern like `/users/:id`) not `req.path` (actual value) to avoid leaking sensitive data (tokens, IDs).
- In the HTTP logger, handle both `res.on('finish')` and `res.on('close')` for aborted requests.

### Error Handling

- The shared error handler (`@mes/core`) guards against `req.i18n` being undefined (JSON parse errors happen before i18n middleware).
- Operational errors (4xx) are returned to the client but not logged.
- Unexpected errors (5xx) are logged with `event: 'error.unexpected'` and stack trace.
- Never let the error handler itself throw — always guard external dependencies.

### Commit Messages

Commitlint enforces conventional commits with **lowercase subject**:

```
feat: add user avatar upload
fix: handle malformed json in error handler
build: update turbo config
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

### Git Hooks

- **pre-commit**: `lint-staged` (biome check --write)
- **commit-msg**: commitlint
- **pre-push**: `pnpm typecheck && pnpm test`

### Code Style (Biome)

- 2-space indent, 100 char line width, single quotes, trailing commas
- Semicolons and arrow parens only as needed
- Imports auto-organized by biome

## Testing

- **Unit tests**: Vitest + `testcontainers` (real MongoDB in Docker via `@testcontainers/mongodb`). Files: `src/**/*.{test,spec}.ts`. Setup in each service's `src/test/setup.ts` or via the shared `setupMongoTestContainer` helper in `@mes/testing`.
- **Contract tests**: Vitest + `testcontainers`. Config: `vitest.contract.config.ts`.
- **Why testcontainers (not `mongodb-memory-server`)**: MongoDB has no official Alpine binaries, so `mongodb-memory-server` cannot pull a binary in our Alpine-based Docker images without manual `MONGOMS_SYSTEM_BINARY` workarounds. Testcontainers runs the MongoDB image `docker-compose.yml` pins, read through `MONGO_IMAGE` in `@mes/testing`, for unit, contract and e2e tests, which keeps test infrastructure identical to production and CI.
- `@mes/testing` provides shared utilities (source-only, no build needed).

### Test Philosophy (CRITICAL — READ THIS FIRST)

**The purpose of testing is to catch bugs that would happen in production.** Tests must replicate production conditions as closely as possible. When a test passes but production would fail, the test is lying — and a lying test is worse than no test at all.

**Target: zero production errors.** Every test should ask: "Would this catch a real production bug?" If the answer is no, the test is wasting time. If a test hides a real problem, it is actively harmful.

**Rules:**
- **Write tests the way production behaves.** Use real infrastructure (testcontainers) over mocks wherever possible. Test edge cases that production will encounter. Never simplify away the conditions that would cause production failures.
- **Never mock infrastructure to hide connection/config issues.** If a service function calls Redis/MQTT/etc. and tests hang because the dependency isn't available, the fix is to configure the dependency properly (e.g., ioredis `enableOfflineQueue: false` so commands fail fast) — not to mock the module away. Mocking hides the bug, the bug ships to production, production crashes.
- **Never use `passWithNoTests`** or similar flags to skip test failures. If there are no tests, the test command should fail.
- **Never change test expectations to match broken implementations.** If the test matches the spec and the implementation fails, that is an implementation bug — report it, don't hide it.
- **A green CI that hides problems is worse than a red CI that exposes them.** The goal is production reliability, not green checkmarks.

## Docker

- Two-phase build: `tsc -b` for packages, then service-level `tsc`.
- Releases: a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which pushes the six images to GHCR and attaches the install package. `install.sh` installs and upgrades a server; see `docs/operations/installation.md`.
- `.tsbuildinfo` excluded via `.dockerignore`.
- `node-linker=hoisted` in Docker `.npmrc` for flat module resolution.
- Named volumes persist all stateful data: MongoDB, Redis, user uploads, Loki, Grafana, Alloy positions.
- All infra services have healthchecks. `depends_on` uses `condition: service_healthy`.
- Loki labels: only `level` (from JSON) + `service` (from Docker Compose metadata) — query everything else via `| json` in LogQL.
