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
pnpm build                         # full build (packages + user service)
pnpm build:packages                # shared packages only (tsc -b)
pnpm build:watch                   # watch mode for packages
pnpm build:clean                   # clean + full rebuild
pnpm dev                           # user-service dev mode (tsx watch)
pnpm typecheck                     # type check all packages
pnpm lint                          # biome lint check
pnpm lint:fix                      # biome auto-fix + format
pnpm format                        # format only
pnpm test                          # all tests via turbo
pnpm --filter user-service test    # user service unit tests
pnpm test:contract                 # contract tests (testcontainers)
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
| `@mes/core` | Error classes, Express middleware (error handler, request context via AsyncLocalStorage, validation), shutdown helpers |
| `@mes/auth` | JWT authentication + RBAC permission middleware, Redis-backed cache with singleflight |
| `@mes/cache` | Redis cache-aside pattern with singleflight dedup |
| `@mes/logger` | Winston logger (JSON in prod, colorized in dev), structured HTTP logger middleware, Morgan for dev |
| `@mes/events` | Redis Streams publish/consume with consumer groups, auto-ACK, pending recovery, traceId propagation |
| `@mes/health` | Health/readiness endpoints with dependency-injected probes |
| `@mes/openapi` | Zod-OpenAPI document generation |
| `@mes/testing` | Shared test utilities (source-only, exports `src/index.ts` directly) |

### Service Apps

- `user/` — User, Role, Speciality CRUD + auth. Express 5, Mongoose 9, Zod 4.
- New services go in `apps/*` (workspace configured). Follow `user/` structure exactly.

### Infrastructure

- **API Gateway**: Traefik (routing, rate limiting, compression)
- **Database**: MongoDB 7 (Mongoose 9)
- **Cache & Events**: Redis 7 (ioredis for cache, Redis Streams for cross-service events)
- **Observability**: Grafana + Loki + Promtail (centralized logging, <1GB RAM total)
- **i18n**: i18next with filesystem backend, HTTP middleware for per-request locale

### Cross-Service Communication

Redis Streams via `@mes/events`. Publisher injects `traceId` from ALS context into event data. Consumer extracts it and seeds ALS via `runInContext` — enables end-to-end distributed tracing across services.

Streams: `events.user` (published by user-service), `events.station` (consumed by user-service).

## Adding a New Service

1. Create `apps/<service-name>/` following `user/` directory structure
2. Add `tsconfig.json` extending `../../tsconfig.app.json` with references to needed packages
3. Add to `pnpm-workspace.yaml` (already includes `apps/*`)
4. Add to root `tsconfig.json` references
5. Add Dockerfile following `user/Dockerfile` pattern (two-phase build)
6. Add service to `docker-compose.yml` with Traefik labels, healthcheck, and named volumes
7. Create event stream `events.<service>` and register handlers in consuming services
8. Reuse shared packages — do not duplicate auth, cache, logging, error handling, or health check logic

## Key Conventions

### API Design

Standard REST: POST (create), PUT (full replace), PATCH (partial update), DELETE. No action-specific routes (if it is really needed) — state transitions and structural changes are field updates via PATCH; backend detects what changed and runs validation/side effects.

### Mongoose Models

- All Mongoose models must use `timestamps: true` (`createdAt`, `updatedAt` auto-managed).
- Models that are created or modified by authenticated users include `createdBy` and `updatedBy` fields (user `_id`). Internal/system operations use a system identifier.

### TypeScript / Imports

- All packages: `"type": "module"` + NodeNext — **imports MUST use `.js` extensions** (even for `.ts` source).
- Shared packages: `composite: true` for project references.
- Service apps: extend `tsconfig.app.json` (`composite: false`, `verbatimModuleSyntax`).

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

- **Unit tests**: Vitest + `mongodb-memory-server`. Files: `src/**/*.{test,spec}.ts`.
- **Contract tests**: Vitest + `testcontainers` (real MongoDB in Docker). Config: `vitest.contract.config.ts`.
- `@mes/testing` provides shared utilities (source-only, no build needed).

## Docker

- Two-phase build: `tsc -b` for packages, then service-level `tsc`.
- `.tsbuildinfo` excluded via `.dockerignore`.
- `node-linker=hoisted` in Docker `.npmrc` for flat module resolution.
- Named volumes persist all stateful data: MongoDB, Redis, user uploads, Loki, Grafana, Promtail positions.
- All infra services have healthchecks. `depends_on` uses `condition: service_healthy`.
- Loki labels: only `level` (from JSON) + `service` (from Docker Compose metadata) — query everything else via `| json` in LogQL.
