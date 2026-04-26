# Performance Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `performance/` microservice that owns OEE calculation, planned/unplanned stop domain, reason policy, and stop classification for the Aimes MES, backed by Work Center / Production / Telemetry internal APIs.

**Architecture:** Node 20 / Express 5 / Mongoose 9 service. Follows the same monorepo conventions as `user/`, `work-center/`, `production/`, `telemetry/`: module-per-feature (`model`, `service`, `controller`, `routes`, `validators`, `*.test.ts`), shared packages under `@mes/*`, Redis Streams for events, on-demand OEE with no persisted result cache.

**Tech Stack:** Node 20, pnpm, TypeScript 5.5+ NodeNext, Express 5, Zod 4, Mongoose 9, ioredis 5, Redis Streams, Winston 3, Vitest + `mongodb-memory-server` + `testcontainers`, Biome 2. Uses `@mes/core`, `@mes/auth`, `@mes/cache`, `@mes/logger`, `@mes/events`, `@mes/health`, `@mes/openapi`, `@mes/privileges`, `@mes/testing`.

**Spec:** `performance-service-spec.md`

---

## Global Non-Goals (v1)

- No persisted OEE result cache / read model.
- No interval-tree / segment-tree data structures; sorted-merge + two-pointer sweep is sufficient.
- No MQTT subscription in Performance; run-mode signals arrive via `events.telemetry` stream only.
- No public `GET /api/v1/time-context` endpoint; OEE is queried directly.
- No loops over single-item Production/Telemetry endpoints on the OEE hot path — implement/consume real batch endpoints.
- No DTO files purely as Java-style ceremony; use local `type` aliases or Zod-inferred types.

---

## Project Conventions (must follow — see `CLAUDE.md`)

These are non-negotiable across the service. Each phase that creates a model / controller / event / test inherits these.

### Mongoose model checklist (applies to every new model in Phase 2, 3, 6 — Reason, Policy, PlannedStop, PlannedStopTemplate, PlannedStopSchedule, UnplannedStop, RunModeProcessingState, any others)

- `timestamps: true` (schema option).
- `createdBy` / `updatedBy` / `startedBy` / `endedBy` are `Schema.Types.ObjectId` **without** `ref` (cross-service boundary; User lives in a different service).
- `__v` must be hidden from all API responses:
  - `toObject`/`toJSON` transforms `delete ret.__v`.
  - **AND** `.lean()` queries add `.select('-__v')` explicitly (lean bypasses transforms).
- Do **not** use `.lean()` on `findOneAndUpdate` / `findOneAndDelete` when the model has `auditLogPlugin` applied — the post hooks call `doc.toObject()` which doesn't exist on lean results. `.lean()` on `find`/`findById` is fine.
- Apply `auditLogPlugin` to every CRUD-tracked model.
- `strict: true`.

### Response format (every public controller)

- GET (single / computed): `{ data }`.
- GET (list): `{ data: [...], pagination: { page, limit, total, totalPages } }`.
- Mutations (POST/PATCH/DELETE): `{ data, message }` (message is the translated i18n string).
- Error (delegated to shared `@mes/core` handler): `{ error: { code, message, details? } }`. Never emit `success` fields.
- **OEE endpoint specifically:** the spec-defined shape keeps `diagnostics` **inside** `data`. Do **not** relocate diagnostics to a `meta` field. The only conformance edit is ensuring the envelope is `{ data: { ...oee, diagnostics: [...] } }`.
- List endpoints for reasons / planned-stops / planned-stop-templates / planned-stop-schedules / unplanned-stops must support pagination (`page`, `limit` query params; default limit 50, max 200). OEE is a single computed result — no pagination.
- No auto-populate; clients opt in via `?populate=<whitelist>` only where explicitly supported.

### Event payload rule (applies to every `events.performance` emit)

- Payloads carry only the IDs needed for routing and identification — **never full documents**. Consumers that need full state fetch via REST.
- Canonical minimum payload for any stop event: `{ plannedStopId | unplannedStopId, workCenterId }`. For reason: `{ reasonId }`. For policy: `{}` (policy is a singleton).
- Every emit helper automatically merges `traceId` from ALS (matches Production's `jobs/events.ts`).

### Routing key immutability (Performance decision)

- `PlannedStop.workCenterId`, `UnplannedStop.workCenterId`, `PlannedStopTemplate.workCenterIds`, `PlannedStopSchedule.workCenterIds`, and the conversion path (unplanned → planned) are all **immutable with respect to workCenterId**. An unplanned stop can only be converted to a planned stop on the **same** work center. `PATCH` validators reject `workCenterId` changes (400).
- Because of this, Performance emit helpers do **not** need a `previousWorkCenterId` argument. Each routing key stays stable across the entity's lifetime.
- **Future note:** if a later spec revision allows moving a stop between work centers, the `previousWorkCenterId` convention from `CLAUDE.md` kicks in and the affected emit helpers must gain the parameter.

### Logging convention (short)

- Every new `logger.{debug,info,warn,error}` call includes an `event:` field using dot-notation: `domain.entity.action`. Example starter names: `reason.bootstrap.micro_stop_ensured`, `policy.singleton.initialized`, `run_mode.debounce.triggered`, `run_mode.unplanned_stop.opened`, `oee.calc.started`, `oee.calc.not_calculable`, `planned_stop.schedule.materialized`, `planned_stop.conflict_rejected`.
- First arg is always the human-readable message string (Winston API requirement).
- 4xx NOT logged (HTTP logger captures). 5xx logged via shared error handler.

### Test infrastructure policy

- ioredis config in test setup: `enableOfflineQueue: false` — commands fail fast when Redis isn't up, rather than tests hanging.
- Never use `passWithNoTests` (or equivalent flag) in Vitest config — an empty suite must fail.
- Never adjust a test expectation to match a broken implementation. If a test derived from the spec fails, the implementation is the bug — report it. Contract tests use `testcontainers` real MongoDB; do not mock infrastructure to hide connection issues.

### Date/time validation policy (global — not per phase)

- All Zod validators for instants use an `iso8601UtcStrict` helper shared under `utils/validators.ts`. The helper rejects offset-less inputs such as `2026-04-04T12:30:00` and `2026-04-04 12:30:00`; only `...Z` is accepted.
- One contract-level test in Phase 10 asserts a representative sample of public and internal endpoints reject offset-less datetimes with HTTP 400 — this replaces per-phase rejection tests.

---

## File Structure

### New service files (created)

```
performance/
  Dockerfile
  package.json
  tsconfig.json
  vitest.config.ts
  vitest.contract.config.ts
  .env
  .npmrc                              (hoisted)
  src/
    app.ts
    config/index.ts
    constants/identity.ts
    core/
      errors/index.ts                 (re-export from @mes/core)
      loaders/{express,i18n,index,mongoose}.ts
      middleware/{error-handler,request-context,validate}.ts
      types/{api.types,express.d}.ts
    lib/
      cache.ts                        (Redis cache + shared dedup)
      logger.ts                       (Winston + http logger)
      redis.ts                        (redisClient + streamClient)
      shutdown.ts
      internal-api/                   (one client file per target service)
        work-center.client.ts
        production.client.ts
        telemetry.client.ts
      openapi/setup.ts
      plugins/
        audit-log.model.ts
        audit-log.plugin.ts
    utils/
      db.ts
      pagination.ts
      validators.ts                   (shared Zod helpers: objectId, iso8601 UTC, positive int…)
      intervals.ts                    (pure clipping / merge / subtract / two-pointer sweep)
      interval.sweep.ts               (two-pointer sweep for job-order × stop × windows)
    modules/
      reason/
        reason.model.ts
        reason.service.ts
        reason.controller.ts
        reason.routes.ts
        reason.validators.ts
        reason.bootstrap.ts           (MICRO_STOP bootstrap at startup)
        reason.service.test.ts
        reason.bootstrap.test.ts
      policy/
        policy.model.ts               (PerformanceRuntimePolicy)
        policy.service.ts
        policy.controller.ts
        policy.routes.ts
        policy.validators.ts
        policy.service.test.ts
      planned-stop/
        planned-stop.model.ts
        planned-stop.service.ts
        planned-stop.controller.ts
        planned-stop.routes.ts
        planned-stop.validators.ts
        planned-stop.service.test.ts
      planned-stop-template/
        planned-stop-template.model.ts
        planned-stop-template.service.ts
        planned-stop-template.controller.ts
        planned-stop-template.routes.ts
        planned-stop-template.validators.ts
        planned-stop-template.service.test.ts
      planned-stop-schedule/
        planned-stop-schedule.model.ts
        planned-stop-schedule.service.ts
        planned-stop-schedule.controller.ts
        planned-stop-schedule.routes.ts
        planned-stop-schedule.validators.ts
        planned-stop-schedule.scheduler.ts
        planned-stop-schedule.recurrence.ts
        planned-stop-schedule.service.test.ts
        planned-stop-schedule.scheduler.test.ts
      unplanned-stop/
        unplanned-stop.model.ts
        unplanned-stop.service.ts
        unplanned-stop.controller.ts
        unplanned-stop.routes.ts
        unplanned-stop.validators.ts
        unplanned-stop.service.test.ts
      run-mode/
        run-mode-processing-state.model.ts
        run-mode.processor.ts         (event-driven: consumes tag.value.recorded)
        run-mode.reconciler.ts        (startup reconciliation)
        run-mode.debounce.ts
        run-mode.processor.test.ts
        run-mode.reconciler.test.ts
      oee/
        oee.types.ts                  (local types: minimal projections)
        oee.service.ts                (orchestrator)
        oee.controller.ts
        oee.routes.ts
        oee.validators.ts
        oee.repository.ts             (stop projection loader; MICRO_STOP excluded at query time)
        interval-normalizer.ts        (sorted merge + planned precedence + non-OEE reason set)
        availability.calc.ts
        productivity.calc.ts
        quality.calc.ts
        virtual-work-center.ts        (recursive composition)
        diagnostics.ts                (typed diagnostic builder)
        oee.service.test.ts
        interval-normalizer.test.ts
        availability.calc.test.ts
        productivity.calc.test.ts
        quality.calc.test.ts
        virtual-work-center.test.ts
      oee/__contract__/
        oee.contract.test.ts          (HTTP + real Mongo via testcontainers)
    jobs/
      events.ts                       (emit to events.performance)
      subscribers.ts                  (consume events.production, events.work_center, events.telemetry, events.user)
      subscribers.test.ts
    test/
      setup.ts                        (mongodb-memory-server)
      contract-setup.ts               (testcontainers)
      fixtures/
        reason.fixtures.ts
        stop.fixtures.ts
        job-order.fixtures.ts
```

### Changes to existing files

```
packages/privileges/src/index.ts
  + PERFORMANCE_PRIVILEGES block (see Phase 1)
  + append to PRIVILEGES aggregate

pnpm-workspace.yaml
  + performance

tsconfig.json (root)
  + performance reference

docker-compose.yml
  + performance service block (port 3004)
  + traefik labels for /api/v1/oee, /api/v1/reasons, /api/v1/planned-stops,
    /api/v1/planned-stop-templates, /api/v1/planned-stop-schedules, /api/v1/unplanned-stops
  + depends_on: mongodb, redis
  + env wiring INTERNAL_API_WORK_CENTER, INTERNAL_API_PRODUCTION, INTERNAL_API_TELEMETRY

realtime/src/jobs/subscribers.ts
  + register 'events.performance': { '*': catchAll }

realtime/src/gateway/router.ts
  + routing rule — events carrying workCenterId go to `wc:{workCenterId}` (same pattern as others)

production/src/modules/product-standard/product-standard.routes.ts
  + POST /product-standards/timelines:batch (bulk timeline path)
  + (optional) GET /product-standards/timeline (single) if not already implemented

production/src/modules/product-standard/product-standard.service.ts
  + findTimelinesBatch(items): real bulk aggregation; one $in query, grouped in memory

production/src/modules/internal/job-order-records-batch.routes.ts (NEW file)
  POST /job-order-records:batch — accepts items[] + include[], returns
    { quantityAdjustmentsByJobOrderId, scrapEntriesByJobOrderId }
production/src/modules/internal/job-order-records-batch.service.ts (NEW)
production/src/modules/internal/job-order-records-batch.test.ts (NEW)

production/src/core/loaders/express.ts
  + mount product-standards batch + job-order-records batch on /internal/v1 only
  (keep mountSharedRoutes intact; these are internal-only endpoints)

telemetry/src/modules/historian/historian.routes.ts
  + POST /historian/:tagId/produced-summary   (multi-window; internal)
  + POST /historian/:tagId/speed-summary      (multi-window; internal)

telemetry/src/modules/historian/historian.controller.ts
  + getProducedSummary, getSpeedSummary handlers accepting body.windows[]

telemetry/src/modules/historian/historian.service.ts
  + producedSummaryMulti(tagId, windows)      (batched, single scan per tag when possible)
  + speedSummaryMulti(tagId, windows)         (reuses per-tag baseline lookup once)

telemetry/src/modules/historian/historian.validators.ts
  + multiWindowSchema { windows: [{ from, to }] } with iso UTC validation
```

---

## Phase 1 — Service Scaffold + Package/Docker Wiring

### 1.1 Amaç

Stand up `performance/` as a working Express service identical in shape to `production/` / `telemetry/`: boot, health, auth, i18n, internal/public router split, event publisher/consumer wired, Dockerfile and docker-compose service entry. No business logic yet, but reachable via Traefik and able to publish/consume an `events.performance` `ping` message end-to-end.

### 1.2 Değişecek dosya/modül türleri

- **New:** `performance/package.json`, `performance/tsconfig.json`, `performance/Dockerfile`, `performance/.env`, `performance/.npmrc`, `performance/src/config/index.ts`, `performance/src/constants/identity.ts`, `performance/src/lib/{logger,redis,cache,shutdown}.ts`, `performance/src/core/loaders/{express,i18n,mongoose,index}.ts`, `performance/src/core/middleware/{error-handler,request-context,validate}.ts`, `performance/src/core/types/{express.d,api.types}.ts`, `performance/src/utils/{db,pagination,validators}.ts`, `performance/src/jobs/{events,subscribers}.ts`, `performance/src/app.ts`, `performance/src/lib/openapi/setup.ts`, `performance/src/lib/plugins/audit-log.{model,plugin}.ts`, `performance/src/test/setup.ts`, `performance/vitest.config.ts`, `performance/vitest.contract.config.ts`.
- **Modify:** `pnpm-workspace.yaml`, root `tsconfig.json`, `docker-compose.yml`, `packages/privileges/src/index.ts`.

### 1.3 Ön koşullar / dependencies

- None outside existing infra. Mirrors `production/` exactly.

### 1.4 Uygulama adımları

1. Copy `production/package.json` → `performance/package.json`; rename to `performance-service`; keep every `@mes/*` and dev dep set identical.
2. Copy `production/tsconfig.json` → `performance/tsconfig.json`; references: `core, auth, cache, logger, events, health, openapi, privileges, testing`.
3. `pnpm-workspace.yaml`: add `performance`.
4. Root `tsconfig.json`: add `{ "path": "./performance" }` reference.
5. Copy `production/src/config/index.ts`; add envs:
   - `PORT=3004`
   - `INTERNAL_API_WORK_CENTER`, `INTERNAL_API_PRODUCTION`, `INTERNAL_API_TELEMETRY`.
6. Copy `production/src/lib/{logger,redis,cache,shutdown}.ts` as-is; logger `serviceName: 'performance'`, redis cache `keyPrefix: 'performance:'`.
7. Copy `core/loaders/*` and `core/middleware/*` verbatim from `production/`.
8. `constants/identity.ts`: `export const SYSTEM_IDENTITY = 'ffffffffffffffffffffffff'`.
9. `jobs/events.ts`: helper `emit(type, data)` publishing to `events.performance`, identical in shape to Production's `jobs/events.ts`.
10. `jobs/subscribers.ts`: shell `createStreamConsumer` with empty stream map (filled in later phases), runInContext, health-safe. Consumer group `performance-service`.
11. `app.ts`: bootstrap → `initLoaders()` (mongoose + redis + i18n + express), start server, initialize `initSubscribers()` after listen, graceful shutdown (mirrors Production's `app.ts`).
12. `core/loaders/express.ts`: same shape as Production's; split `/api/v1` (authenticated) vs `/internal/v1` (SYSTEM_IDENTITY middleware). No route modules yet beyond health.
13. `Dockerfile`: two-phase build mirroring `production/Dockerfile`; final CMD `node dist/app.js`.
14. `docker-compose.yml`: new `performance` block — port `3004`, env vars, `depends_on: mongodb, redis`, healthcheck `/health/ready`, traefik labels for all public prefixes below. `/internal/v1` NOT exposed through traefik.

    Traefik rules (priority 5):
    ```
    PathPrefix(`/api/v1/oee`) ||
    PathPrefix(`/api/v1/reasons`) ||
    PathPrefix(`/api/v1/planned-stops`) ||
    PathPrefix(`/api/v1/planned-stop-templates`) ||
    PathPrefix(`/api/v1/planned-stop-schedules`) ||
    PathPrefix(`/api/v1/unplanned-stops`)
    ```
15. `packages/privileges/src/index.ts`: add `PERFORMANCE_PRIVILEGES` (comma-separated codes, camelCase verb+entity):
    ```
    readOee, accessOeeScreen,
    readReasons, writeReasons, createReasons, deleteReasons, accessReasonsScreen,
    readPlannedStops, writePlannedStops, createPlannedStops, deletePlannedStops, executePlannedStops, accessPlannedStopsScreen,
    readPlannedStopTemplates, writePlannedStopTemplates, createPlannedStopTemplates, deletePlannedStopTemplates, executePlannedStopTemplates, accessPlannedStopTemplatesScreen,
    readPlannedStopSchedules, writePlannedStopSchedules, createPlannedStopSchedules, deletePlannedStopSchedules, accessPlannedStopSchedulesScreen,
    readUnplannedStops, writeUnplannedStops, deleteUnplannedStops, closeUnplannedStops, convertUnplannedStops, accessUnplannedStopsScreen,
    readPerformancePolicy, writePerformancePolicy, accessPerformancePolicyScreen
    ```
    Append to `PRIVILEGES` aggregate.
16. `packages/testing` — no change (source-only).
17. `vitest.config.ts`: standard pattern (mongodb-memory-server via `test/setup.ts`).
18. `vitest.contract.config.ts`: standard pattern (`testcontainers` setup). Contract test glob: `src/**/__contract__/*.contract.test.ts`.
19. Skeleton smoke test: `performance/src/app.smoke.test.ts` — boot `initLoaders()` with memory Mongo and assert `/health/live` returns 200.

### 1.5 Test planı

- **Unit:** `app.smoke.test.ts` boots loaders and hits `/health/live` and `/health/ready`.
- **Service tests:** (deferred to later phases).
- **Contract:** (deferred).
- Run `pnpm build` from the root; build must succeed with the new project reference.
- Run `pnpm --filter performance-service test` — smoke passes.
- Manually: `docker compose up -d --build performance` then `curl http://localhost/api/v1/oee` → 401 (auth middleware active; route not yet implemented).

### 1.6 Riskler ve edge-case'ler

- **Port/path clash with work-center (3001)**: Performance uses 3004 to avoid collision. Double-check healthcheck URL.
- **Privilege aggregate:** missing from `PRIVILEGES` = system-admin won't auto-grant. Verify after rebuild.
- **Stream consumer started before DB connected** can crash consumer loop — keep Production's order: DB → Redis → subscribers after `listen`.
- **Docker Traefik path priority**: reason `/api/v1/reasons` does not collide with any existing route. `/api/v1/unplanned-stops`, `/api/v1/planned-stops` are new.

### 1.7 Done kriteri

- `pnpm build` clean.
- `pnpm --filter performance-service typecheck` clean.
- `docker compose up --build performance` healthy.
- `/health/ready` returns 200.
- `jobs/events.ts`-style helper can successfully XADD to `events.performance` (manual verification against a running redis).
- Privilege list contains new Performance codes; `getInvalidPrivilegeCodes([...])` returns `[]` for them.

---

## Phase 2 — Reason Model + Immutable MICRO_STOP Bootstrap + Policy

### 2.1 Amaç

Implement the `Reason` domain and the `PerformanceRuntimePolicy` singleton, including the MICRO_STOP bootstrap that runs before the service accepts traffic, plus all API guards that keep `isSystemDefault=true` reasons immutable.

### 2.2 Değişecek dosya/modül türleri

- **New:** `modules/reason/reason.{model,service,controller,routes,validators,bootstrap}.ts`, `modules/reason/reason.service.test.ts`, `modules/reason/reason.bootstrap.test.ts`.
- **New:** `modules/policy/policy.{model,service,controller,routes,validators}.ts`, `modules/policy/policy.service.test.ts`.
- **Modify:** `core/loaders/index.ts` to call `bootstrapSystemReasons()` after mongoose connect.
- **Modify:** `core/loaders/express.ts` to mount reason + policy routes on both `/api/v1` (with `requirePermission`) and `/internal/v1` (SYSTEM_IDENTITY).
- **Modify:** `jobs/events.ts` to add `reason.{created,updated,deleted}` emitters (for future work — no consumers yet).

### 2.3 Ön koşullar / dependencies

- Phase 1 complete.

### 2.4 Uygulama adımları

1. **Reason model** (`reason.model.ts`):
   - Fields per spec: `code` (unique), `name` (unique), `description`, `usages: ['planned_stop' | 'unplanned_stop' | 'scrap']` with `$each` enum validator, `affectsOee: Boolean (default true)`, `isSystemDefault: Boolean (default false)`, `workCenterIds: [ObjectId]`, `canStartManually`, `canBeScheduled`, `canConvertFromUnplanned`, `requiresDescription`, `isActive (default true)`, `props: Map<String, Mixed>`, audit `createdBy`/`updatedBy` as ObjectId (no ref), `timestamps: true`.
   - Indexes: `{ code: 1 } unique`, `{ name: 1 } unique`, `{ usages: 1, affectsOee: 1 }`, `{ isActive: 1 }`.
   - `toObject`/`toJSON` transforms strip `__v`.
   - Audit plugin applied.
2. **Validators** (`reason.validators.ts`):
   - Zod schemas: `createReasonSchema`, `patchReasonSchema`, `reasonListSchema` with `affectsOee?`, `usage?` (comma-sep), `fields?` (comma-sep, only `_id` allowed in v1), `isActive?`, `search?`.
   - Validate `canStartManually`, `canBeScheduled`, `canConvertFromUnplanned` only meaningful when `usages` ⊇ stop usage. If set with scrap-only usage → 400.
3. **Service** (`reason.service.ts`):
   - `create/get/list/update/remove` standard CRUD.
   - List `findIds({ affectsOee?, usages?[] })` projection returning only `_id` when `fields=_id`.
   - `getSystemReasonIdByCode(code)` returns ObjectId or throws `error.micro_stop_missing` (500).
   - `update`: if target record `isSystemDefault` → reject 409 `error.reason_system_default_immutable` for any change (code, name, usages, affectsOee, isActive, props).
   - `remove`: soft-delete path — if any stop references this reason (check `PlannedStop.reasonId`, `UnplannedStop.reasonId`, `PlannedStopSchedule.reasonId`, `PlannedStopTemplate.reasonId`, `PlannedStopTemplate.overrunReasonId`), set `isActive=false` and 200; else hard-delete. `isSystemDefault` → always reject.
   - Emit `reason.created/updated/deleted` events.
4. **Controller + Routes** (`reason.{controller,routes}.ts`): standard; `requirePermission('readReasons' | 'writeReasons' | 'createReasons' | 'deleteReasons')`. `GET /reasons?fields=_id` returns `{ data: [{ _id }] }` (projection applied in service).
5. **Bootstrap** (`reason.bootstrap.ts`):
   - `bootstrapSystemReasons(): Promise<void>` — upsert-if-missing (by `code`) `MICRO_STOP`. Never overwrite if present (treat as idempotent).
   - After upsert, assert the record matches the required invariants (`usages=['unplanned_stop']`, `affectsOee=false`, `isSystemDefault=true`, `isActive=true`). If not, throw `error.micro_stop_invalid` and halt boot.
6. **Loaders** (`core/loaders/index.ts`): call `bootstrapSystemReasons()` after mongoose connect, before express listen.
7. **PerformanceRuntimePolicy model** (`policy.model.ts`):
   - Singleton-per-workCenter + factory default: `workCenterId?: ObjectId`. Unique partial index `{ workCenterId: 1 } unique, partial: { workCenterId: { $exists: true } }`; factory default lives as the `workCenterId: null` record, uniqueness enforced by `{ workCenterId: 1 } unique`.
   - Fields per spec with defaults (`runModeDebounceMs=0`, `microStopThresholdMs=120000`, `actualOutputWindowMode='execution_span'`, `productivityAggregationMode='total_ratio'`, `allowProductivityOver100=true`), `updatedBy: ObjectId`, `updatedAt`.
8. **Policy service**:
   - `resolveForWorkCenter(workCenterId): Promise<Policy>` → work-center-specific record if exists, else factory default (cached via `@mes/cache` keyed by `policy:{wcId|factory}`).
   - `upsert(workCenterId | null, patch, userId)` with audit + cache invalidation.
9. **Policy routes**: `GET /performance-policies`, `PUT /performance-policies` (factory), `GET /performance-policies/work-centers/:workCenterId`, `PUT /performance-policies/work-centers/:workCenterId`, `DELETE /performance-policies/work-centers/:workCenterId`. Permissions `readPerformancePolicy` / `writePerformancePolicy`.

### 2.5 Test planı

- **Unit — reason.service.test:**
  - create/get/list/update/remove happy paths.
  - Unique code/name enforced.
  - `fields=_id` returns only `{_id}` objects.
  - `affectsOee=false&usage=planned_stop,unplanned_stop,scrap&fields=_id` returns the correct filtered set.
  - Update system-default reason → 409.
  - Delete reason referenced by PlannedStop → soft-delete (`isActive=false`); not referenced → hard-delete.
  - Invalid usage combinations rejected.
- **Unit — reason.bootstrap.test:**
  - No MICRO_STOP exists → creates with invariants.
  - MICRO_STOP exists → unchanged.
  - MICRO_STOP exists but mutated (`affectsOee=true`) → bootstrap throws + logs `event='reason.bootstrap.invariant_violation'`.
- **Unit — policy.service.test:**
  - Resolve returns factory default when WC override missing.
  - Resolve returns WC override when present.
  - Upsert factory (`null`) and WC override independently, cached lookups invalidated.
  - Defaults applied to new records.
- **Edge cases:**
  - Race: two concurrent `bootstrapSystemReasons()` calls → one wins; other observes the record and exits.
  - `DELETE` on system-default reason → 409 regardless of references.
- **Performance-sensitive:** `findIds` uses `.select({_id:1}).lean()` + `{ usages: 1, affectsOee: 1 }` index. Add an explicit test that `.explain()` uses `IXSCAN`.

### 2.6 Riskler ve edge-case'ler

- **Mutating MICRO_STOP via admin tooling**: must 409 on every PATCH/DELETE path, including `isActive` toggling.
- **Soft-delete fallback** must run before hard-delete check to avoid dropping historically-referenced rows.
- **Singleton policy indexing**: `workCenterId: null` record clashes with partial-unique if misconfigured; use a plain unique on `workCenterId` (null only once).
- **Cached factory default** must invalidate after upsert — otherwise stale OEE calculations until TTL.

### 2.7 Done kriteri

- MICRO_STOP exists after boot with correct invariants; all guards reject mutations.
- `GET /api/v1/reasons?affectsOee=false&usage=planned_stop,unplanned_stop,scrap&fields=_id` returns a minimal list.
- Policy resolvable for both factory and WC override.
- All unit tests pass.

---

## Phase 3 — Planned/Unplanned Stop Domain + Runtime Rules

### 3.1 Amaç

Ship the stop domain (models, services, APIs) plus the run-mode stop automation (event-driven processor + startup reconciliation + debounce + MICRO_STOP classification) for work centers that have `tagBindings.runModeTagId`.

### 3.2 Değişecek dosya/modül türleri

- **New:** `modules/planned-stop/*`, `modules/planned-stop-template/*`, `modules/planned-stop-schedule/*`, `modules/unplanned-stop/*`, `modules/run-mode/*`.
- **New:** `lib/internal-api/{work-center.client,telemetry.client}.ts`.
- **Modify:** `jobs/subscribers.ts` to register handlers for `events.telemetry` (`tag.value.recorded`), `events.work_center` (`work_center.updated`, `work_center.created`, `work_center.archived`, `work_center.deleted`, `work_center.metric_composition.changed`).
- **Modify:** `jobs/events.ts` to add planned/unplanned/template/schedule emitters (spec-listed types).
- **Modify:** `core/loaders/index.ts` to start the `PlannedStopScheduler` and `RunModeReconciler` after boot.

### 3.3 Ön koşullar / dependencies

- Phase 2 (reason + policy + MICRO_STOP) complete.
- Work Center `/internal/v1/work-centers/:id` returns `tagBindings` + `metricComposition` + `type` + `productivityMode` (existing in work-center service; verify).
- Telemetry historian `latest` and `state-durations` endpoints (existing).

### 3.4 Uygulama adımları

1. **PlannedStop model** — fields per spec; indexes:
   - `{ workCenterId: 1, plannedStartAt: 1, plannedEndAt: 1 }`
   - `{ workCenterId: 1, status: 1 }` unique partial `{ status: 'active' }`
   - `{ scheduleId: 1, workCenterId: 1, plannedStartAt: 1 }` unique partial `{ source: 'scheduled', scheduleId: { $exists: true } }`
   - `{ reasonId: 1 }`
   - `toObject/toJSON` strip `__v`.
2. **PlannedStopTemplate model** — fields per spec; indexes `{ workCenterIds: 1, isActive: 1 }`, `{ reasonId: 1 }`.
3. **PlannedStopSchedule model** — fields per spec (`recurrence` sub-schema), indexes `{ isEnabled: 1 }`, `{ workCenterIds: 1 }`, `{ reasonId: 1 }`.
4. **UnplannedStop model** — fields per spec; derived state (no `status` field).
   - Indexes: `{ workCenterId: 1 }` unique partial `{ endAt: null }`, `{ workCenterId: 1, startAt: 1, endAt: 1 }`, `{ reasonId: 1 }`.
5. **RunModeProcessingState model** — fields per spec; unique `{ workCenterId: 1, runModeTagId: 1 }`.
6. **PlannedStop service** (`planned-stop.service.ts`):
   - `create(input)` — manual planned stop creation including backdated closed intervals when permitted.
   - `start(id, userId)` — implements **Planned Stop Start Rule**:
     1. Ensure no other planned stop is active on `workCenterId`.
     2. Close any open unplanned stop at `actualStartAt` via `UnplannedStopService.closeIfOpen(workCenterId, at)`.
     3. Set `status='active'`, `actualStartAt`, clear `actualEndAt`, `operatorId`.
     - Validate reason has `canStartManually=true` for manual starts; `canBeScheduled=true` for scheduled.
     - Reject if target planned stop is `cancelled`.
   - `close(id, body, userId)` — implements **Planned Stop Ends**:
     1. Set `actualEndAt=body.actualEndAt ?? now`; `status='closed'`.
     2. Resolve current run-mode state at `actualEndAt` via `telemetryClient.getLatest(runModeTagId)`.
     3. If value `< 1` and no other planned stop covers `actualEndAt`, open a new UnplannedStop with `startAt=actualEndAt` (unless one is already open).
   - `update` — allow reason/description/props edits, plannedStart/End window only when `status='planned'` (otherwise require authorized extension flow). **Reject any request that attempts to change `workCenterId`** with 400 `error.planned_stop_work_center_immutable` (enforce in the PATCH Zod validator: `workCenterId` is not in the allowed field set). This is the routing-key immutability rule declared in Project Conventions — it is what lets the emit helpers skip `previousWorkCenterId`.
   - `list` — filters `workCenterId`, `from`, `to`, `status`.
   - Reject creating planned windows that overlap another non-cancelled PlannedStop on the same WC using `new.plannedStartAt < existing.plannedEndAt && new.plannedEndAt > existing.plannedStartAt`.
7. **PlannedStopTemplate service** — `start(id, body, userId)`:
   - Validate template `isActive` and work-center scope.
   - Apply **Planned Stop Start Rule** atomically (transaction): close open unplanned, create PlannedStop `{ source:'template', status:'active', plannedStartAt=now, plannedEndAt=now+defaultDurationMs, actualStartAt=now }`.
   - `close(plannedStopId, userId)` — apply `overrunPolicy`:
     - `split_to_unplanned`: planned ends at `plannedEndAt`; create new `UnplannedStop` from `plannedEndAt` → `actualEndAt` with `template.overrunReasonId` and `source='manual'`.
     - `extend_planned_until_close`: set `plannedEndAt=actualEndAt`.
     - `alert_only`: set `actualEndAt` as is and emit diagnostic event (reuse event stream — no separate channel).
8. **PlannedStopSchedule service + recurrence** (`planned-stop-schedule.recurrence.ts`):
   - Pure function `nextOccurrenceAfter(schedule, now): { plannedStartAt, plannedEndAt }`.
   - Works in `recurrence.timezone` for wall-clock; emits UTC instants.
   - Service CRUD with overlap validation per work-center (same overlap predicate as planned stops, across scheduled occurrences materialized in the immediate window).
9. **PlannedStopScheduler** (`planned-stop-schedule.scheduler.ts`):
   - On boot: load all enabled schedules, for each, schedule a one-shot timer at `plannedStartAt - createBeforeStartMs`.
   - On fire: for each `workCenterId` in `schedule.workCenterIds`, upsert PlannedStop by `{ scheduleId, workCenterId, plannedStartAt }` (unique partial index). Duplicate key → already handled.
   - After create, if `startMode='automatic'` and `plannedStartAt <= now`, immediately start via PlannedStopService.start (late scheduler path keeps planned window but `actualStartAt=now`).
   - Recompute on `schedule.{created,updated,deleted}` events (local only — no inter-service impact).
   - Timer reference pattern mirrors `work-center/src/modules/shift/shift.scheduler.ts`.
10. **UnplannedStop service** (`unplanned-stop.service.ts`):
    - `openFromRunMode(workCenterId, startAt)` — idempotent: find-or-insert with unique partial index `{ workCenterId, endAt: null }`. If another open unplanned stop exists, return it.
    - `closeIfOpen(workCenterId, endAt, options?)` — atomic: `findOneAndUpdate({ workCenterId, endAt: null }, { $set: { endAt } }, { returnDocument: 'after' })`.
       - Then, if `(endAt - startAt) <= policy.microStopThresholdMs` and `reasonId` is unset, set `reasonId = microStopReasonId`.
    - `createManual(body, userId)` — manual open unplanned (rare operator path).
    - `close(id, body, userId)` — manual close with reason assignment.
    - `convertToPlanned(id, body, userId)` — implements conversion:
      - Validate reason has `canConvertFromUnplanned=true`.
      - **Same-work-center rule:** the target PlannedStop must belong to the same `workCenterId` as the source UnplannedStop. Reject cross-work-center conversion with 400 `error.conversion_work_center_mismatch`. New PlannedStop created by the conversion path inherits `workCenterId` from the unplanned stop (immutable).
      - If `body.plannedStopId`: link to existing planned stop and set `convertedToPlannedStopId` + `endAt` (if open).
      - Else create new PlannedStop `{ source:'converted', workCenterId=u.workCenterId, plannedStartAt=u.startAt, plannedEndAt=u.endAt, actualStartAt=u.startAt, actualEndAt=u.endAt }` and link.
    - `list` — filter `state=open|closed|converted` as derived (spec).
    - `patch` — assign reason, description, props (not time fields without authorized backdated correction path). **`workCenterId` is immutable** — rejected by the PATCH validator with 400 `error.unplanned_stop_work_center_immutable`.
11. **Internal API client — Work Center** (`lib/internal-api/work-center.client.ts`):
    - `getById(id)` returns `{ type, productivityMode, tagBindings, metricComposition, status }`. Use `@mes/cache` with short TTL and singleflight, key `wc:{id}`.
    - Invalidate on `events.work_center.updated|archived|reactivated|deleted|metric_composition.changed` (subscriber in Phase 9 but wire invalidation now).
12. **Internal API client — Telemetry** (`lib/internal-api/telemetry.client.ts`):
    - `getLatest(tagId)`, `getStateDurations(tagId, from, to)` used by run-mode flow.
    - Produced/speed summary methods added in Phase 5.
13. **Run-mode processor** (`run-mode/run-mode.processor.ts`):
    - Consumed from `events.telemetry` `tag.value.recorded` (only events for `tagBindings.runModeTagId` of monitored WCs; filter by a map kept in memory from Work Center events).
    - Cursor: read `RunModeProcessingState` by `{workCenterId, runModeTagId}`. If `event.occurredAt <= lastProcessedOccurredAt`, skip.
    - Branches:
      - `value < 1` (stopped):
        - If active PlannedStop covers `occurredAt` → no-op, update cursor.
        - Else if `policy.runModeDebounceMs === 0` → call `UnplannedStopService.openFromRunMode(workCenterId, occurredAt)` immediately.
        - Else record a `stoppedCandidate` in a Redis key `runmode:candidate:{workCenterId}:{runModeTagId}` with `firstStoppedAt=occurredAt` + TTL `debounceMs+2s`; schedule a delayed confirmation worker via `setTimeout`-in-process **and** a DB-persisted scheduled task `runModeDebounceQueue` so the confirmation survives restart. Simpler path for v1: use a periodic 1-second tick job that flushes matured candidates — both fire-and-forget correctness guards are fine.
        - Key idempotency rule: confirmation reads the candidate, re-reads the latest value via telemetry `latest`, and only opens when the latest sample is still `< 1`.
      - `value >= 1` (running):
        - Cancel pending candidate (delete Redis key / mark DB queue entry).
        - Call `UnplannedStopService.closeIfOpen(workCenterId, occurredAt)`.
    - After successful handling, update cursor (`$set: { lastProcessedOccurredAt, lastProcessedValue }`).
14. **Run-mode reconciler** (`run-mode/run-mode.reconciler.ts`):
    - On boot, for each WC with `runModeTagId`:
      - If cursor exists: call `telemetryClient.getStateDurations(runModeTagId, from=cursor.lastProcessedOccurredAt, to=now)`; apply each segment's boundary transitions through `openFromRunMode`/`closeIfOpen` using the deterministic rules (debounce still honored using policy).
      - If no cursor: call `getLatest(runModeTagId)`. If `value < 1` and no open unplanned stop, go through the debounce-aware open path with `startAt=latest.occurredAt`. If `value >= 1`, just initialize the cursor.
      - Never create a stop from `latest` alone when `state-durations` returned non-empty segments for the recovery range.
15. **Route mounting** — only public `/api/v1/*` routes for stops exposed via Traefik. Template `start`, planned stop `start`/`close`, unplanned stop `close`/`convert-to-planned`, planned stop `POST` and `PATCH`, list endpoints per spec.
    - Internal fetchers for stops are not required in v1 (OEE reads via local repository).

### 3.5 Test planı

- **Unit — planned-stop.service.test:**
  - create/update/remove CRUD.
  - `start` closes an open UnplannedStop at `actualStartAt` and rejects when another PlannedStop already active.
  - `close` opens a new UnplannedStop when `latest run mode < 1` and no active planned stop covers `actualEndAt`.
  - `close` does NOT open a new UnplannedStop when another open unplanned stop exists.
  - Backdated closed planned stop (`actualStartAt`/`actualEndAt` provided) stored correctly.
  - Overlap validation rejects overlapping planned windows across manual + scheduled.
  - PATCH attempt that includes a different `workCenterId` → 400 `error.planned_stop_work_center_immutable` (routing-key immutability guard).
- **Unit — planned-stop-template.service.test:**
  - Starting same template at two different times creates two different PlannedStops.
  - Template is not consumed/mutated on start.
  - Close before `plannedEndAt` → planned stop closed, no overrun unplanned.
  - `split_to_unplanned` creates unplanned overrun `plannedEndAt → actualEndAt` with `overrunReasonId`.
  - `extend_planned_until_close` updates `plannedEndAt` to `actualEndAt`.
  - Start while another planned stop active → 409 via Planned Stop Start Rule.
- **Unit — planned-stop-schedule.service.test + recurrence.test:**
  - `nextOccurrenceAfter` for `daily`, `weekly` (with `daysOfWeek`), `monthly` in Europe/Istanbul timezone with DST boundary.
  - Overlap validation across schedules and manual planned stops.
- **Unit — planned-stop-schedule.scheduler.test:**
  - Scheduler materializes one PlannedStop per `{scheduleId, workCenterId, plannedStartAt}`.
  - Duplicate scheduler retries (simulate duplicate key error) → no additional occurrence.
  - `startMode=automatic`: occurrence remains `planned` before `plannedStartAt`; starts at `plannedStartAt`.
  - Late automatic run: keeps planned times, `actualStartAt=now`.
  - `startMode=manual`: occurrence remains `planned` until explicit start.
- **Unit — unplanned-stop.service.test:**
  - `openFromRunMode` is idempotent (unique partial index ensures at most one open).
  - `closeIfOpen` sets `endAt` atomically; MICRO_STOP assignment when duration ≤ threshold and reason unset.
  - Manual close does not overwrite operator-selected reason.
  - `convert-to-planned` requires `canConvertFromUnplanned=true`; with existing planned stop uses provided id; otherwise creates new planned stop from the interval.
  - `convert-to-planned` with a `body.plannedStopId` whose `workCenterId` differs from the unplanned stop's `workCenterId` → 400 `error.conversion_work_center_mismatch`.
  - `convert-to-planned` creating a new PlannedStop inherits `workCenterId` from the source unplanned stop (no caller-provided override honored).
  - Derived state filter (`open`/`closed`/`converted`) returns correct subsets.
  - PATCH attempt that includes a different `workCenterId` → 400 `error.unplanned_stop_work_center_immutable`.
- **Unit — run-mode.processor.test:**
  - Event older than cursor → skipped.
  - Stopped event with active PlannedStop covering `occurredAt` → no stop created.
  - Stopped event, `debounceMs=0` → stop created immediately with `startAt=occurredAt`.
  - Stopped event, `debounceMs>0` → no stop yet; candidate stored. After `debounceMs` with value still `< 1` → stop created with `startAt=occurredAt` (first stopped event time, not confirmation time).
  - Stopped event, `debounceMs>0`, value returns `>=1` before debounce → no stop created, candidate cleared.
  - Running event closes open unplanned; cursor advanced.
  - Short (≤ threshold) stop: closed stop gets `MICRO_STOP` reason automatically.
- **Unit — run-mode.reconciler.test:**
  - Cursor exists, state-durations returns mixed segments → correct sequence of opens/closes.
  - No cursor + latest `value<1` → one open stop with `startAt=latest.occurredAt` (debounce-aware).
  - No cursor + latest `value>=1` → cursor initialized only.
  - State-durations returns segments in recovery range → `latest` is not used to create a stop.
- **Contract tests** (deferred to Phase 10):
  - Run-mode processor + reconciler against real Redis + Mongo.
- **Edge cases:**
  - `plannedStopSchedule` daysOfWeek empty on `weekly` → reject at validator.
  - Timezone DST forward: occurrence that "would have fallen" in the missing hour handled deterministically (shift to next valid instant).
  - Unique partial index for open unplanned stop prevents concurrent double-open under race.
- **Performance-sensitive:**
  - `PlannedStopScheduler` boot does not `createBeforeStartMs` loop for every occurrence — single timer per schedule.
  - `run-mode.processor` does O(1) Mongo ops per event.

### 3.6 Riskler ve edge-case'ler

- **Debounce across restart:** if only in-process timer is used, missed events during downtime break debounce correctness. Use DB-persisted candidate (or re-reconcile on boot using state-durations) so debounce is restart-safe.
- **Atomicity of template start:** must close open unplanned and create planned in one logical unit. Either use a Mongo session/transaction, or:
  1. `closeIfOpen(workCenterId, now)` atomic updateOne
  2. Create PlannedStop with unique active index — on duplicate key, the first writer wins; second rolls back the close is not safe. Simpler: use a session.
- **Convert-to-planned uncovered parts:** spec mandates normalizer handle uncovered portions — OEE phase must apply linked planned reason flags to uncovered parts (Phase 6) rather than Phase 3 requiring pre-splits.
- **Work-center `tagBindings.runModeTagId` removed:** subscriber must stop managing run-mode stops; cursor can be kept but no new candidates.
- **MICRO_STOP threshold change after a stop closes** does NOT retro-tag historical stops. (Matches on-demand OEE semantics but worth documenting.)

### 3.7 Done kriteri

- All stop CRUD + start/close/convert endpoints reachable and authorized.
- PlannedStopScheduler runs, creates occurrences idempotently, starts automatic ones on time.
- Run-mode processor handles stream events with debounce and MICRO_STOP classification.
- Reconciler runs on boot; replays missed events correctly.
- All unit tests pass.

### 3.8 Acceptance fixes (2026-04-21)

Post-acceptance audit found the following issues; all fixed in this phase (no new phase):

1. **Routes not mounted** — `planned-stop`, `planned-stop-template`, `planned-stop-schedule`, `unplanned-stop` routes were imported but missing from `mountSharedRoutes` in `core/loaders/express.ts`. → added to the shared mount list (reachable on both `/api/v1` and `/internal/v1`).
2. **Automation boot/shutdown missing** — `core/loaders/index.ts` only called `initSubscribers`. → now also calls `reconcileOnBoot()`, `startPlannedStopScheduler()`, `startDebounceTick()` after `initExpress`; `app.ts` shutdown now calls `stopDebounceTick()` and `stopPlannedStopScheduler()` before closing connections.
3. **Run-mode bootstrap circular** — `seedRunModeTagMap` and `reconcileOnBoot` seeded only from existing `RunModeProcessingState` cursors, so a fresh deploy had nothing to route telemetry events to (WC `created`/`updated` events are not replayed for pre-existing records). → work-center service now exposes a dedicated internal contract, `GET /internal/v1/work-centers/run-mode-monitors`, that returns exactly the cold-start set `{ data: [{ workCenterId, runModeTagId }] }` — filter is server-side Mongo (`type:'physical'` + `status:'active'` + `tagBindings.runModeTagId` exists) with `.select()` projection + `.lean()`, no pagination, no client-side filtering. On the performance side, `lib/internal-api/run-mode-monitors.client.ts` (`listRunModeMonitors()`, separate from `work-center.client.ts`) calls this endpoint; `seedRunModeTagMap` unions cursor-seeded entries with its result. Route is mounted on `internalRouter` **before** `mountSharedRoutes` in `work-center/src/core/loaders/express.ts` so the specific path wins over the generic `GET /work-centers/:id` (whose param validator would otherwise reject `run-mode-monitors` as a non-ObjectId).
4. **Permission codes mismatch** — `unplanned-stop.routes.ts` used `createUnplannedStops` / `executeUnplannedStops` but these were not in `@mes/privileges`. → added both codes to `PERFORMANCE_PRIVILEGES`.
5. **`split_to_unplanned` overrun bug** — template `closeFromTemplate` called `createManualUnplanned({ startAt: plannedEndAt })` but `createManual` never accepted `endAt`, so the intended closed overrun interval `[plannedEndAt → actualEndAt]` was persisted as an OPEN stop, colliding with the `{workCenterId, endAt:null}` unique partial index. → `CreateManualUnplannedStopInput` now accepts optional `endAt`; when provided, `createManual` writes a closed doc (with `closedBy`) and emits both `unplanned_stop.created` + `unplanned_stop.closed`. Template service passes `endAt: actualEndAt`. Test strengthened to assert `endAt` + `closedBy`.
6. **`workCenterIds` not immutable on PATCH** — `patchTemplateSchema` and `patchScheduleSchema` accepted `workCenterIds`, violating the routing-key immutability rule. → field removed from both patch schemas; `.strict()` mode now rejects the payload.

#### Test plan addendum (run-mode-monitors contract)

- **Unit — `work-center/src/modules/internal/__tests__/run-mode-monitors.test.ts`:**
  - Returns only WCs that are `type:'physical'` AND `status:'active'` AND have `tagBindings.runModeTagId` set (archived / virtual / no-tag WCs excluded).
  - Response shape is exactly `{ data: [{ workCenterId, runModeTagId }] }` — no extra fields leak through the projection.
  - No matching WCs → `{ data: [] }` (not 404).
- **Unit — `performance/src/lib/internal-api/run-mode-monitors.client.test.ts`:**
  - Calls `GET {INTERNAL_API_WORK_CENTER}/internal/v1/work-centers/run-mode-monitors` and returns parsed `data`.
  - Non-ok HTTP response → returns `[]` (warn logged, never throws — seed must be fault-tolerant).
  - Fetch rejection → returns `[]` (warn logged, never throws).
- **Route-ordering guard:** verified implicitly by the endpoint test above passing under the current mount order — if someone moves `runModeMonitorsRoutes` after `mountSharedRoutes`, the generic `GET /work-centers/:id` ObjectId validator catches the path first and the endpoint test 400s.
- `listMonitoredWorkCenters()` (the earlier generic-paginated helper) is removed from `work-center.client.ts`; no test references it anymore.

---

## Phase 4 — Production Internal Batch Endpoints Required by Performance OEE

### 4.1 Amaç

Add the batch internal endpoints in Production that the OEE hot path depends on, in a way that avoids looping single-item endpoints.

### 4.2 Değişecek dosya/modül türleri

- **New:** `production/src/modules/internal/job-order-records-batch.routes.ts`, `.service.ts`, `.test.ts`.
- **Modify:** `production/src/modules/product-standard/product-standard.service.ts`, `.routes.ts`, `.validators.ts` — add `findTimelinesBatch` and `/product-standards/timelines:batch`.
- **Modify:** `production/src/core/loaders/express.ts` — mount the batch routes only on `/internal/v1` (SYSTEM_IDENTITY). Do not add them to `mountSharedRoutes` (they're internal-only).
- **Modify:** `production/src/modules/job-order/job-order.service.ts` — ensure `/internal/v1/job-orders?activeFrom=...&activeTo=...&workCenterId=...` (already supported via `buildJobOrderFilters`) uses efficient indexes; verify index `{ workCenterId: 1, startTime: 1, endTime: 1 }` exists on `JobOrder`.

### 4.3 Ön koşullar / dependencies

- Phase 1.

### 4.4 Uygulama adımları

1. **product-standards/timelines:batch**:
   - Validator: `items: [{ jobOrderId (objectId), workCenterId (objectId), productId (objectId), from (ISO UTC), to (ISO UTC) }]`. Reject offset-less / local datetimes.
   - Service `findTimelinesBatch(items)`:
     - Group items by `(workCenterId, productId)` to deduplicate fetches.
     - Single Mongo query per unique pair (or one `$or` aggregation for all pairs) using index `{ productId: 1, workCenterId: 1, validFrom: -1 }`. Ensure the index exists.
     - For each group: fetch all standards where `validFrom <= max(to for items in group)` sorted by `validFrom DESC`.
     - Per item, compute baseline (`max validFrom ≤ from`) + revisions in `(from, to]`.
     - Returns `{ items: [{ jobOrderId, standards[], qualityFlags: string[] }] }` with minimal projection (only `_id, productId, workCenterId, validFrom, idealOutputPerMinute, counterMultiplier`).
     - If no baseline and no revision found → `qualityFlags = ['no_standard_for_interval']` (OEE turns it into `missing_product_standard`).
   - Permission guard: `/internal/v1` → SYSTEM_IDENTITY `['*']`.
2. **job-order-records:batch**:
   - Validator: `items: [{ jobOrderId, from, to }]`, `include: ['quantity_adjustments' | 'scrap_entries']` (at least one required).
   - Service:
     - Projection (field names must match existing Production models — `QuantityAdjustment.amount`, `ScrapEntry.amount`; `QuantityAdjustment.reason` is a String, `ScrapEntry.reasonId` is an ObjectId):
       - quantity adjustments: `{_id, jobOrderId, workCenterId, productId, amount, time, reason?}`.
       - scrap entries: `{_id, jobOrderId, workCenterId, productId, amount, reasonId, startTime, endTime}`.
     - If `include` contains `quantity_adjustments`: build `$or` of per-item `{ jobOrderId, time: { $gte: from, $lte: to } }`. Run as a single `find` with `.lean().select(...)`.
     - If `include` contains `scrap_entries`: build `$or` of per-item `{ jobOrderId, startTime: { $lte: to }, $or: [{ endTime: null }, { endTime: { $gte: from } }] }`. Run as a single `find`.
     - Group results by `jobOrderId` in memory.
     - Return `{ quantityAdjustmentsByJobOrderId, scrapEntriesByJobOrderId }`.
3. Mount routes on `/internal/v1` only. Keep out of `mountSharedRoutes` (rule: internal-only operations never go public).
4. Ensure indexes: `QuantityAdjustment`: `{ jobOrderId: 1, time: 1 }`. `ScrapEntry`: `{ jobOrderId: 1, startTime: 1, endTime: 1 }`. Add migrations-less index declarations to models (`schema.index(...)`).
5. OpenAPI: update Production's OpenAPI registry to include the two new internal endpoints (documentation only).

### 4.5 Test planı

- **Unit — product-standard.service.test:**
  - `findTimelinesBatch` returns correct baseline + revisions per item.
  - Items sharing `(workCenterId, productId)` share a single DB read (assert via spy on `ProductStandard.find`).
  - Missing baseline returns `qualityFlags: ['no_standard_for_interval']`, empty `standards`.
- **Unit — job-order-records-batch.service.test:**
  - Quantity-adjustments-only, scrap-entries-only, both.
  - Proper grouping by jobOrderId.
  - Scrap entries whose interval partially overlaps `from..to` included; fully outside excluded.
  - No over-fetching when items empty → no DB hit.
- **Integration / supertest:**
  - `POST /internal/v1/product-standards/timelines:batch` with SYSTEM identity returns 200.
  - Public `/api/v1/...timelines:batch` not exposed (routes not mounted on apiRouter).
- **Edge cases:**
  - ISO non-UTC string rejected (`2026-04-18T10:00:00` → 400).
  - Duplicate items in request handled (no duplicate records).

### 4.6 Riskler ve edge-case'ler

- **Response size blow-up** for ranges with many standards/adjustments/scrap: projection is mandatory. Do not return full docs.
- **Query engine quirks:** `$or` across many items with different `from/to` can skip indexes; ensure the `$or` stays selective (adequate indexes + limit by `jobOrderId` first).
- **Internal-only boundary**: do not leak via apiRouter; review `express.ts` registration.

### 4.7 Done kriteri

- Batch endpoints reachable via internal HTTP.
- Unit tests pass.
- `findTimelinesBatch` performs ≤ 1 DB read per unique (workCenterId, productId) pair.

---

## Phase 5 — Telemetry `produced-summary` and `speed-summary` Multi-Window Endpoints

### 5.1 Amaç

Add multi-window summary endpoints in Telemetry so Performance can get all produced counts and speed areas for a query range in one HTTP round trip per tag.

### 5.2 Değişecek dosya/modül türleri

- **Modify:** `telemetry/src/modules/historian/historian.routes.ts`, `.controller.ts`, `.service.ts`, `.validators.ts`.
- **Modify:** `telemetry/src/modules/historian/calculations/counter.calc.ts`, `speed.calc.ts` — reuse existing single-window logic, expose a batched variant that scans once per tag.

### 5.3 Ön koşullar / dependencies

- Phase 1.

### 5.4 Uygulama adımları

1. **Validator**: `multiWindowSchema` = `{ windows: array(min 1, max 500) of { from: iso UTC, to: iso UTC } }`.
2. **Routes**:
   - `POST /internal/v1/historian/:tagId/produced-summary` (authenticated / public equivalent exists only internally).
   - `POST /internal/v1/historian/:tagId/speed-summary`.
   - **Note:** current `historian.routes.ts` uses `requirePermission('readHistorian')`. Expose these as internal-only (mount on internal router with SYSTEM identity) OR also require permission on public side. Follow the convention already in place for Telemetry: existing historian routes are mounted on the shared router (`requirePermission`). Add these two as internal-only to keep surface small; Performance calls via SYSTEM.
3. **Service**:
   - **Window overlap contract (caller responsibility):** these endpoints compute each window independently and return the arithmetic sum across windows as `total`. Overlapping windows are permitted by the endpoint (useful for generic callers) but **Performance MUST send non-overlapping windows**. If Performance sends overlaps, the intersecting region is double-counted — which is a caller bug, not an endpoint bug. Telemetry does not merge input windows. Document this on the endpoint and in the Performance `telemetryClient` wrapper JSDoc.
   - `producedSummaryMulti(tagId, windows)`:
     - Normalize and sort windows by `from`.
     - Single call to `historianRepository.find(tagId, overallFrom - previousLookback, overallTo)` using existing counter-scan pipeline.
     - Walk each window computing `value` by existing counter reset/rollover logic. Reuse `counter.calc.ts` helpers; do not duplicate.
     - Per-window `qualityFlags: string[]` (`missing_baseline`, `counter_reset_observed`, `samples_missing`).
     - Total = sum of all window values (as-provided; no overlap merge).
   - `speedSummaryMulti(tagId, windows)`:
     - Reuse `speed.calc.ts` time-weighted integration with last-value-forward semantics.
     - One per-tag fetch of samples covering `[min(from) - baselineLookback, max(to)]`; walk windows computing `durationMs`, `timeWeightedAverage`, `valueArea`, `sampleCount`.
     - Total = `{ durationMs, timeWeightedAverage, valueArea }` summed / weighted across the provided windows (as-provided; no overlap merge — `durationMs` is the sum of per-window durations, not the measure of their union).
4. **Controller:** body-validated via `validateBody(multiWindowSchema)`.
5. **Performance side — telemetry client**:
   - `telemetryClient.producedSummary(tagId, windows)`, `telemetryClient.speedSummary(tagId, windows)` that POST to internal URL.

### 5.5 Test planı

- **Unit — counter.calc.test (batched):**
  - Multiple windows inside a single counter-reset span — resets applied deterministically.
  - Overlapping windows (permitted at the endpoint layer; double-count in total is the caller's responsibility): each window is returned independently and `total` sums them as-provided.
  - Windows with no samples in range → `value=0`, `qualityFlags: ['samples_missing']`.
  - Window with baseline missing → `qualityFlags: ['missing_baseline']`.
- **Unit — speed.calc.test (batched):**
  - Time-weighted average over windows matches sum of single-window results.
  - `valueArea` is integral of speed over `durationMs`.
  - Windows with zero samples after baseline propagation → `valueArea=0`, `timeWeightedAverage=0`, flags.
- **Integration / supertest:**
  - POST endpoints return the documented shape.
  - Reject `windows=[]`, non-UTC timestamps, `to < from`.
- **Performance-sensitive:**
  - Single DB read per tag regardless of window count (spy `historianRepository.find` call count — expect 1).

### 5.6 Riskler ve edge-case'ler

- **Sample gaps spanning a window boundary**: last-value-forward must be applied per window consistently with the existing single-window semantics; otherwise speed results diverge between batch and single.
- **Counter rollover across window boundary**: must apply the same unwrap logic as the single-window endpoint.
- **Memory**: 500-window requests on a large range could be heavy — acceptable upper bound; document and cap in validator.
- **Caller-side overlap responsibility**: the endpoint is generic and does not de-duplicate overlapping windows. Performance must collapse `actualOutputWindows` and speed windows to non-overlapping form before calling (Phase 7 step; add assertion in Phase 7 calc test — see below).

### 5.7 Done kriteri

- Both endpoints documented + tested.
- Performance's telemetry client can batch successfully.
- Single-window correctness is preserved byte-for-byte (compare single vs batch in tests).

---

## Phase 6 — OEE Interval Normalizer + Availability Calculation

### 6.1 Amaç

Deliver the deterministic interval normalizer (clip → merge → planned-over-unplanned precedence → exclude MICRO_STOP → compute `productionRunWindows`) and the availability calculation that consumes it. No Telemetry calls yet — productivity/quality later.

### 6.2 Değişecek dosya/modül türleri

- **New:** `modules/oee/interval-normalizer.ts`, `modules/oee/availability.calc.ts`, `modules/oee/oee.repository.ts`, `modules/oee/oee.types.ts`, `modules/oee/diagnostics.ts`.
- **New:** `modules/oee/interval-normalizer.test.ts`, `availability.calc.test.ts`.
- **New:** `utils/intervals.ts` — pure helpers: `clip(a,b,from,to)`, `subtract(windows, stops)`, `merge(intervals)`, `sweep(jobs, stops)`.

### 6.3 Ön koşullar / dependencies

- Phase 2 (reason + policy), Phase 3 (stop models + services).

### 6.4 Uygulama adımları

1. **Types** (`oee.types.ts`) — local projections only, no DTO files:
   ```ts
   type OeeRange = { from: Date; to: Date }
   type JobWindow = { jobOrderId: string; productId: string; workCenterId: string; start: Date; end: Date }
   type StopInterval = {
     _id: string
     workCenterId: string
     reasonId: string | null
     source: 'planned' | 'unplanned'
     start: Date
     end: Date
     linkedPlannedStopId?: string | null   // for converted unplanned
   }
   type NormalizedStop = StopInterval & { effectiveAffectsOee: boolean; isMicroStop: false }
   ```
2. **Stop repository** (`oee.repository.ts`):
   - `findStopsForOee({ workCenterId, from, to, excludeSystemReasonCodes: ['MICRO_STOP'] })`:
     - Resolve MICRO_STOP reason id once via `reasonService.getSystemReasonIdByCode('MICRO_STOP')`.
     - Projection: minimal fields (`_id`, `workCenterId`, `reasonId`, for planned `plannedStartAt/plannedEndAt/actualStartAt/actualEndAt/status`, for unplanned `startAt/endAt/convertedToPlannedStopId`).
     - Planned query: `status ∈ ['active','closed']`, `plannedStartAt < to`, `(actualEndAt ?? plannedEndAt) > from OR status='active'`.
     - Unplanned query: exclude MICRO_STOP id, `startAt < to`, `(endAt == null OR endAt > from)`.
     - Returns both, already mapped into uniform `StopInterval[]`.
   - Converted unplanned: carry `linkedPlannedStopId` → resolved to linked planned-stop reason during normalization.
3. **Interval normalizer** (`interval-normalizer.ts`):
   - Signature:
     ```ts
     normalize(args: {
       range: OeeRange
       jobOrderWindows: JobWindow[]
       planned: StopInterval[]
       unplanned: StopInterval[]
       nonOeeReasonIds: Set<string>      // resolved current reason ids where affectsOee=false
     }): {
       clippedJobWindows: JobWindow[]     // sorted by start
       calculationStops: NormalizedStop[] // sorted, unioned, planned precedence, MICRO_STOP already excluded
       productionRunWindows: OeeRange[]   // jobWindows MINUS merged stop intervals (stop-free segments), sorted
       diagnostics: Diagnostic[]
     }
     ```
   - Steps:
     1. Clip `jobOrderWindows` to `range`. Drop zero/negative.
     2. For planned stops: realized interval = `[actualStartAt ?? plannedStartAt, actualEndAt ?? min(query.to, now, plannedEndAt)]`, then cap end at `plannedEndAt` (authorized extension already reflected in updated `plannedEndAt`). Drop those with `status='cancelled'` or no effective start (future planned without `actualStartAt`).
     3. For unplanned stops: realized interval = `[startAt, endAt ?? range.to]`.
     4. Resolve converted unplanned: mark `linkedPlannedStopId`; treat as planned-source in the union (for precedence).
     5. Clip all stops to `range`.
     6. **Sorted merge + two-pointer sweep** (`utils/intervals.sweep`):
        - Sort planned by `start`, unplanned by `start`.
        - Union intervals, with planned precedence: overlapping unplanned parts are split or clipped. Implementation:
          1. Compute `plannedMerged` = merge overlapping planned intervals (flatten).
          2. For each unplanned interval, subtract `plannedMerged`; keep remainder pieces (may become multiple pieces).
          3. If split occurred, emit diagnostic `overlapping_stop_records_clipped` (info/warning per spec).
        - Result: deterministic `calculationStops` — the union never double-counts time.
     7. Exclude MICRO_STOP: already excluded at repository level by id. Sanity-filter here too by code (belt-and-braces).
     8. Resolve `effectiveAffectsOee` per normalized stop:
        - For planned: `reason.affectsOee` at current state via `nonOeeReasonIds.has(reasonId) ? false : true`. Missing reasonId on planned is impossible (validated at create).
        - For unplanned: `nonOeeReasonIds.has(reasonId)` → false; no reasonId → `true` (OEE-affecting).
        - For converted unplanned pieces: inherit flags from linked planned's reasonId.
     9. Compute `productionRunWindows`:
        - For each clipped job window, subtract the union of `calculationStops`.
        - Implementation: two-pointer sweep. Complexity `O(j log j + s log s + j + s)`.
     10. Emit diagnostics: `no_job_order_in_range` (when `clippedJobWindows` empty), `overlapping_stop_records_clipped`.
   - Note: MICRO_STOP explicitly **does not** appear in `calculationStops`, and therefore does **not** split `productionRunWindows` — matching spec semantics.
4. **Availability** (`availability.calc.ts`):
   ```ts
   type AvailabilityResult = {
     status: 'ok' | 'no_context' | 'not_calculable'
     ratio: number
     jobOrderTimeMs: number
     oeeEligibleTimeMs: number
     effectiveRunTimeMs: number
     oeeAffectingStopMs: number
     nonEffectiveStopMs: number
   }
   calculateAvailability(input): AvailabilityResult
   ```
   - Inputs: `clippedJobWindows`, `calculationStops`.
   - `jobOrderTimeMs = sum(jobWindow durations)`.
   - Walk `calculationStops` (already unioned): for each `stop` clipped to its overlapping job windows (use two-pointer), compute `stopMs`; if `effectiveAffectsOee`, `oeeAffectingStopMs += stopMs`; else `nonEffectiveStopMs += stopMs`.
   - `effectiveRunTimeMs = jobOrderTimeMs - (oeeAffectingStopMs + nonEffectiveStopMs)`.
   - `oeeEligibleTimeMs = jobOrderTimeMs - nonEffectiveStopMs`.
   - `ratio = oeeEligibleTimeMs > 0 ? effectiveRunTimeMs / oeeEligibleTimeMs : 0`.
   - `status`:
     - `no_context` → `jobOrderTimeMs === 0`.
     - `ok` otherwise.
   - Ratio clamped to `[0, …]` only at response boundary (Phase 9).
5. **Diagnostics builder** (`diagnostics.ts`): typed catalog enum + helper `diag(code, severity, overrides?)`. Accumulated into one list during OEE orchestration.

### 6.5 Test planı

- **Unit — utils/intervals.test:**
  - `clip` basic cases (fully inside, fully outside, boundary).
  - `merge` adjacent/overlapping.
  - `subtract` stop-free segments with sorted two-pointer correctness (fuzz test with 1k random intervals).
- **Unit — interval-normalizer.test:**
  - No job orders → empty clipped, empty production windows, `no_job_order_in_range` diagnostic.
  - Stop fully inside job window → single split into two production windows.
  - Stop crossing job window boundary → correctly clipped to job window.
  - Stop fully outside job window → not included in calculationStops effective time.
  - Planned + unplanned overlapping historically → planned precedence, `overlapping_stop_records_clipped` emitted.
  - MICRO_STOP inside a job window → NOT present in `calculationStops`, does NOT split `productionRunWindows`.
  - Non-effective reason (`affectsOee=false`): present in `calculationStops` with `effectiveAffectsOee=false`.
  - Stop with no reasonId (unplanned): `effectiveAffectsOee=true`.
  - Converted unplanned: pieces inherit linked planned reason flags.
  - Planned stop status='cancelled' → ignored.
  - Future planned (no `actualStartAt`) → ignored.
- **Unit — availability.calc.test** (all spec rules):
  - 100-minute JO + 10-min OEE-affecting stop → `effectiveRunTimeMs=90`, `oeeEligibleTimeMs=100`, ratio=0.9.
  - 100-minute JO + 10-min non-effective stop → `effectiveRunTimeMs=90`, `oeeEligibleTimeMs=90`, ratio=1.0.
  - 100-minute JO + 10-min MICRO_STOP → `effectiveRunTimeMs=100`, `oeeEligibleTimeMs=100`, ratio=1.0.
  - 100-minute JO + 10-min no-reason unplanned → treated as OEE-affecting.
  - Empty job windows → `no_context`.
  - Mixed OEE + non-effective + micro stops → sums are correct and non-double-counted.
  - Stop entirely inside a JO vs crossing JO boundary — both cases cover.
- **Performance-sensitive:**
  - Normalizer complexity: with j=500 JOs, s=2000 stops, completes in <20ms on a typical dev laptop.

### 6.6 Riskler ve edge-case'ler

- **Planned-precedence off-by-one** when a planned ends exactly at an unplanned start — treat as touching (no overlap). Write explicit test.
- **MICRO_STOP reason mutated externally** (forbidden but check) → bootstrap guard prevents this; still, normalizer filters by code defensively.
- **Converted unplanned not linked** (legacy data) → defensive diag `converted_unplanned_missing_link` (warning) and treat as plain unplanned with its current reason.
- **Stops stored as open (endAt=null)** during OEE query: clip to `range.to`.

### 6.7 Done kriteri

- Normalizer deterministic under all overlap/clip scenarios.
- Availability rule table verified via tests.
- Pure function — no I/O inside normalizer/calc.

---

## Phase 7 — Productivity Calculation

### 7.1 Amaç

Consume the normalized windows from Phase 6, pull Telemetry produced/speed summaries (batched per tag), apply product standard timelines (batched per job order), and produce the per-job-order productivity breakdown + aggregated productivity.

### 7.2 Değişecek dosya/modül türleri

- **New:** `modules/oee/productivity.calc.ts`, `productivity.calc.test.ts`.
- **Modify:** `lib/internal-api/production.client.ts`, `telemetry.client.ts` — add batch calls.
- **Modify:** `modules/oee/oee.service.ts` — orchestrator (staged Promise.all as in spec).

### 7.3 Ön koşullar / dependencies

- Phase 4 (production batch endpoints).
- Phase 5 (telemetry batch endpoints).
- Phase 6 (normalizer + availability).

### 7.4 Uygulama adımları

1. **Production client** (`production.client.ts`):
   - `findStartedJobOrders({ workCenterId, from, to })` → `JobWindow[]` (only started job orders; use existing `/internal/v1/job-orders?activeFrom&activeTo&workCenterId` semantic). Projection: `_id, workCenterId, productId, startTime, endTime, code`.
   - `findProductStandardTimelinesBatch(items)` → `Record<jobOrderId, ProductStandard[]>` plus quality flags.
   - `findQuantityAdjustmentsAndScrapBatch({ items, include })` → the two maps.
2. **Orchestrator** (`oee.service.ts`):
   - Stage 1 parallel:
     ```ts
     const [workCenter, policy, microStopReasonId, nonOeeReasonIds, jobOrders, rawStops] =
       await Promise.all([
         workCenterClient.getById(workCenterId),
         policyService.resolveForWorkCenter(workCenterId),
         reasonService.getSystemReasonIdByCode('MICRO_STOP'),
         reasonService.findIds({ affectsOee: false, usages: ['planned_stop', 'unplanned_stop', 'scrap'] }),
         productionClient.findStartedJobOrders({ workCenterId, from, to }),
         oeeRepository.findStopsForOee({ workCenterId, from, to, excludeSystemReasonCodes: ['MICRO_STOP'] })
       ])
     ```
   - Early returns:
     - `workCenter==null` → 404.
     - `workCenter.type==='virtual'` → hand off to `virtual-work-center.ts` (Phase 9).
     - `jobOrders.length===0` → build response with `factors=no_context`, `oee=no_context`, `no_job_order_in_range`.
   - Stage 2 — build clipped job windows, then normalize.
   - Stage 3 parallel:
     ```ts
     const [productStandards, jobOrderRecords] = await Promise.all([
       productionClient.findProductStandardTimelinesBatch(
         jobOrders.map(j => ({ jobOrderId: j._id, workCenterId, productId: j.productId, from: j.clippedStart, to: j.clippedEnd }))
       ),
       productionClient.findJobOrderRecordsBatch({
         items: jobOrders.map(j => ({ jobOrderId: j._id, from: j.clippedStart, to: j.clippedEnd })),
         include: ['quantity_adjustments', 'scrap_entries']
       })
     ])
     ```
   - Stage 4 — determine `actualOutputWindows` per `policy.actualOutputWindowMode`:
     - `execution_span`: `jobOrderWindows` (clipped).
     - `net_run_segments`: intersection of `jobOrderWindows` with `productionRunWindows`, split per job order.
   - Stage 5 — productivity input gathering per job order:
     - Count-based (`workCenter.productivityMode === 'count_based'`):
       - `telemetryClient.producedSummary(tagBindings.productionCounterTagId, windows=actualOutputWindowsPerJo)`.
     - Speed-based:
       - `telemetryClient.speedSummary(tagBindings.speedTagId, windows=actualOutputWindowsPerJo)`.
     - Parallel calls per tag (each tag gets a single HTTP call with all windows).
3. **Productivity calc** (`productivity.calc.ts`):
   - Per job order:
     - Fetch its standards timeline (from the batch map); split each relevant window (`actualOutputWindow`, `productionRunWindow`, `jobOrderWindow`) at standard `validFrom` boundaries.
     - For count-based:
       - `grossProduced` = sum of Telemetry `produced-summary` values across that job order's `actualOutputWindows`.
       - `quantityAdjustmentSum` = sum of `QuantityAdjustment.amount` whose `time` ∈ `jobOrderWindow clipped`.
       - `actualOutput = grossProduced + quantityAdjustmentSum`.
       - `effectiveTargetOutput = Σ (productionRunSubWindowMinutes × standard.idealOutputPerMinute)` for each standard sub-window.
       - `fullJobTargetOutput = Σ (jobOrderSubWindowMinutes × standard.idealOutputPerMinute)`.
     - For speed-based:
       - `actualSpeedArea` from speed-summary `valueArea` (= speedTagValue × ms) over `actualOutputWindows`, split at standard `validFrom` boundaries.
       - **Ratio model (no counterMultiplier):** per sub-window,
         `subActualOutput = (standard.idealOutputPerMinute / standard.idealSpeed) × (subActualSpeedArea / 60000)`. Mathematically equivalent to `subTargetOutput × (avgSpeed / idealSpeed)`; chosen for numerical stability.
       - `counterMultiplier` is a count-based concept (raw cycle/pulse → unit conversion) and MUST NOT be applied here. Cycle/stroke/pulse signals must be modelled as count_based with `productionCounterTagId + counterMultiplier`.
       - If any sub-window's `idealSpeed` is missing/null/≤0 → mark JO `notCalculable=true` (parity with missing-standard handling — silent wrong math is worse than no result).
       - `effectiveTargetOutput = Σ (productionRunSubWindowMs / 60000 × standard.idealOutputPerMinute)`.
       - `fullJobTargetOutput = Σ (jobOrderSubWindowMs / 60000 × standard.idealOutputPerMinute)`.
     - `productionRunMs` = duration of `productionRunWindows ∩ jobOrderWindow`.
     - `productivityRatio = effectiveTargetOutput > 0 ? actualOutput / effectiveTargetOutput : 0`.
     - If baseline standard missing for any sub-window → mark job order `notCalculable=true`, diagnostic `missing_product_standard`.
   - Aggregate across job orders per `policy.productivityAggregationMode`:
     - `total_ratio`: `Σ actualOutput / Σ effectiveTargetOutput`.
     - `run_time_weighted_ratio`: `Σ (ratio * productionRunMs) / Σ productionRunMs` (cap per-JO ratio at 1 when `allowProductivityOver100=false`, before aggregation; spec).
   - If any job order `notCalculable=true` → productivity status=`not_calculable`.
   - Return:
     ```ts
     {
       status: 'ok' | 'no_context' | 'not_calculable'
       ratio: number
       actualOutput, effectiveTargetOutput, fullJobTargetOutput, quantityAdjustment
       actualOutputWindowMode, aggregationMode
       jobOrders: JobOrderProductivityBreakdown[]
     }
     ```
4. **Guardrails**:
   - All ratios stored 0..1 internally; only response boundary converts to `percentage` (Phase 9).
   - Use decimal-safe arithmetic (native numbers are fine for these magnitudes; avoid repeated rounding).
   - Cap on response only, not mid-calculation.

### 7.5 Test planı

- **Unit — productivity.calc.test:**
  - Count-based: 60-min JO, 1000-count standard per hour, actual 900, no stops → `ratio=0.9`.
  - Count-based with quantity adjustment: `amount=-50` applied inside window.
  - Execution_span vs net_run_segments differ when planned non-effective stop inside JO: execution_span keeps actual counts produced during stop → can exceed 1.0; net_run_segments does not.
  - Speed-based with constant speed and matching target: `ratio=1.0`.
  - Product standard change mid-job: windows split; target computed correctly per sub-window.
  - Missing baseline standard for sub-window: job order marked `not_calculable`; overall status `not_calculable`.
  - `allowProductivityOver100=false` caps per-JO ratio at 1.0 before aggregation.
  - `run_time_weighted_ratio` aggregation: two JOs with different productionRunMs → weighted correctly.
  - Empty `actualOutputWindows` → ratio=0, not NaN.
  - `productionRunMs=0` under `run_time_weighted_ratio` → avoid div-by-zero, status `no_context` if everything zero.
- **Unit — oee.service.test (stage orchestration):**
  - Stage 1 runs 6 parallel calls.
  - Stage 3 runs after jobOrders known (assert via spy ordering).
  - Virtual work center short-circuits to Phase 9 path (mocked).
  - No job orders: responds `no_context` without calling Telemetry or standards batch.
- **Performance-sensitive:**
  - With 20 job orders, max 2 HTTP calls to Telemetry (1 per tag; the batch contains all windows).
  - Max 2 HTTP calls to Production (standards batch + records batch).
- **Non-overlapping windows contract (caller responsibility to telemetry):**
  - Assert that the `windows` array passed to `telemetryClient.producedSummary` and `telemetryClient.speedSummary` is non-overlapping (sorted by `from`, each `to[i] <= from[i+1]`). Spy the client call and verify the array passes an `isNonOverlapping(windows)` helper.
  - Scenarios that could produce overlap if not handled: adjacent job orders touching at the same instant (boundary, not overlap — allowed); a job that starts while another is still active in the same work center (spec disallows but test guards against accidental overlap emission). When `actualOutputWindowMode === 'execution_span'`, the set is `clippedJobOrderWindows` (already non-overlapping by job assignment invariant); when it is `net_run_segments`, the set is `intersection(jobOrderWindows, productionRunWindows)` which is also non-overlapping by construction — the assertion documents the invariant.

### 7.6 Riskler ve edge-case'ler

- **Speed-based conversion semantics**: speedTagId represents production speed (units/min, kg/min, m/min, …) — NOT a raw counter rate. `actualOutput` is derived from a speed-ratio against `idealSpeed`, not by multiplying `valueArea` by `counterMultiplier`. Cycle/stroke/pulse counters must be modelled as count_based + `counterMultiplier` instead. If `idealSpeed` is missing for a sub-window the JO becomes `notCalculable`.
- **ProductStandard configuration rules (enforced server-side):**
  - For a `speed_based` work center, every `ProductStandard.idealSpeed` MUST be a positive number; `speedTagId` value is interpreted in the same unit as `idealSpeed`.
  - For a `count_based` work center, every `ProductStandard.counterMultiplier` MUST be set.
  - `production-service` enforces both rules on **create** AND **update** (post-patch effective state) via a shared helper. A patch cannot leave a record in an invalid state for the WC's mode.
  - **Frontend TODO:** the ProductStandard form must show `idealSpeed` as required when the selected work center is `speed_based`, and `counterMultiplier` as required when `count_based`. Server-side guards are the source of truth; the form field is UX only.
- **Backlog: WC `productivityMode` transition guard.** When a WorkCenter switches `productivityMode` (`count_based ↔ speed_based`), existing `ProductStandard` rows for that WC may now be invalid (missing the field required by the new mode). Today this is not validated — relying on the per-standard update guard catches subsequent edits but leaves untouched rows invalid. Before first customer rollout, add a cross-service check on the WC patch path that rejects the mode change unless every active product standard for that WC satisfies the new mode's requirements.
- **`execution_span` fetching production during non-effective stop** is intentional. Test verifies the known behavior (not a bug).
- **`net_run_segments` windows can explode in count**: 100 small segments per job order × 20 JOs = 2000 windows. The multi-window speed/produced endpoint must accept this batch size; the validator limit (500) may need bumping or we clamp windows at 500 per tag and paginate — prefer clamp+paginate with a diagnostic `telemetry_summary_truncated` only if we hit the cap.
- **Division by zero** in ratios → explicit `effectiveTargetOutput > 0` guard.
- **Quantity adjustments outside `clippedJobOrderWindow`**: not applied (spec says within clipped window).

### 7.7 Done kriteri

- Productivity calc produces correct per-JO breakdown + aggregate for all modes.
- Batch calls verified by spies.
- Unit tests pass.

---

## Phase 8 — Quality Calculation

### 8.1 Amaç

Compute quality from produced counts + quantity adjustments + scrap entries, applying reason-driven `affectsOee` split.

### 8.2 Değişecek dosya/modül türleri

- **New:** `modules/oee/quality.calc.ts`, `quality.calc.test.ts`.

### 8.3 Ön koşullar / dependencies

- Phase 7 (produces `actualOutput`, `quantityAdjustmentSum`, scrap entries already loaded in Stage 3).

### 8.4 Uygulama adımları

1. **Quality calc** (scrap is prorated against its own job order's clipped window):
   ```ts
   function calculateQuality(input: {
     grossProducedAcrossExecution: number   // sum over jobOrderWindows (execution_span), NOT over productionRunWindows
     quantityAdjustmentSum: number
     // Scrap entries grouped by jobOrderId upstream; calc receives only the entries for a single job order
     // along with that job order's already-clipped window. The map → per-JO slicing is done in Stage 3 of oee.service.
     scrapEntriesByJobOrder: Array<{
       clippedJobOrderWindow: { start: Date; end: Date }
       entries: Array<{ amount: number; reasonId: string | null; startTime: Date; endTime: Date }>
     }>
     nonOeeReasonIds: Set<string>
     knownReasonIds: Set<string>
   }): QualityResult
   ```
   - `total = grossProducedAcrossExecution + quantityAdjustmentSum`.
   - For each job order group, for each scrap entry, compute prorated effective amount against that entry's own clipped job order window (never any other JO's window — the map is keyed by jobOrderId and entries are read only from their own bucket; this isolation is a consequence of map access, not a defensive filter):
     ```
     entryDurationMs = entry.endTime - entry.startTime            // > 0 by Production validator (endTime > startTime)
     overlapMs       = max(0, min(entry.endTime, window.end) - max(entry.startTime, window.start))
     effective       = entry.amount * (overlapMs / entryDurationMs)
     ```
     - If `overlapMs <= 0` → entry contributes nothing (skip).
   - Classify `effective` against reasonId (classification is applied to the prorated amount, not the raw amount):
     - `reasonId` is null → `oeeAffectingScrap += effective`.
     - `reasonId` not in `knownReasonIds` → `oeeAffectingScrap += effective` + diag `unknown_scrap_reason_treated_as_oee_affecting` (warning, emit once per unique unknown id).
     - `reasonId` in `nonOeeReasonIds` → `excludedScrap += effective`.
     - Else → `oeeAffectingScrap += effective`.
   - `good = max(total - oeeAffectingScrap, 0)`. If `oeeAffectingScrap > total` → diag `scrap_exceeds_total` (warning).
   - `ratio = total > 0 ? good / total : 0`.
   - `status`:
     - `total <= 0` → `no_context` (not `not_calculable`), diag `no_production_total`.
     - Else `ok` (warnings don't downgrade status).
   - Return `{ status, ratio, good, total, oeeAffectingScrap, excludedScrap, totalScrap }` where `totalScrap = oeeAffectingScrap + excludedScrap` (sum of effective amounts, not raw).
2. **Why prorate against clipped job order window (not `productionRunWindows`, not stop-free windows):** scrap is a job-order-scoped record in v1. The only legitimate temporal scope is the job order's execution span clipped to the OEE range — nothing finer, nothing coarser. Do not intersect scrap with planned/unplanned stop windows. Do not split a single scrap entry across multiple job orders (the model guarantees one jobOrderId per entry).
3. **No cross-JO leakage**: the calc reads scrap from `scrapEntriesByJobOrderId[jobOrderId]`. There is no fan-out across other job orders. Do not add a defensive filter — rely on the map being correctly keyed.
4. **No extra interval defensive logic**: `endTime > startTime` is enforced in Production's create/update path (Zod + schema validator). The calc assumes `entryDurationMs > 0`. If the calc is ever reused with unvalidated data, add the guard there; don't bolt it on speculatively.
5. **Scrap reason knownness**: to populate `knownReasonIds` without fetching all reasons, fetch ids referenced by the loaded scrap entries once — `reasonService.findExistingIds(ids)` (single `_id: $in` query, projection `_id`).

### 8.5 Test planı

- **Unit — quality.calc.test (arithmetic, no prorating boundary cases):**
  - Baseline 100 produced, 0 adjustment, 10 scrap entirely inside window with OEE-affecting reason → `quality=0.9`, `good=90`, `total=100`.
  - 100 produced + 20 quantity adjustment, 30 scrap entirely inside with OEE-affecting reason → `total=120`, `good=90`, `quality=0.75`.
  - 100 produced, 10 scrap entirely inside with `affectsOee=false` reason → `excludedScrap=10`, `quality=1.0`.
  - 100 produced, 10 scrap entirely inside, no reasonId → `oeeAffectingScrap=10`, `quality=0.9`.
  - 100 produced, 10 scrap entirely inside, unknown reasonId → `oeeAffectingScrap=10`, warning diag, `quality=0.9`.
  - 50 produced, 100 scrap entirely inside OEE-affecting → `good=0` (clamped), diag `scrap_exceeds_total`.
  - `total=0` → `no_context` + `no_production_total` diag.
  - Mixed scrap (OEE-affecting + excluded + unknown) inside the same window — each bucket accumulates independently.
- **Unit — quality.calc.test (scrap prorating vs clipped job order window):**
  - Scrap fully inside its job order window → effective = full amount.
  - Scrap overlaps window at the start only (entry extends before `window.start`) → effective = amount × (overlapMs / entryDurationMs).
  - Scrap overlaps window at the end only (entry extends past `window.end`) → effective = amount × (overlapMs / entryDurationMs).
  - Scrap entry fully engulfs its job order window (entry starts before window.start and ends after window.end) → effective = amount × (windowDurationMs / entryDurationMs).
  - Scrap entry is fully outside its job order window (no intersection) → contributes 0, no diag.
  - reasonId classification is applied to the prorated amount — verified across all four reason variants (null / unknown / nonOeeReasonIds / oee-affecting) each with a partial-overlap entry.
- **Unit — oee.service.test (map access isolation):**
  - Given scrap entries for JO-A and JO-B in the batch response, the quality calc for JO-A uses only `scrapEntriesByJobOrderId['JO-A']` (test asserts this by inspecting the argument passed to `calculateQuality`, or by seeding a scrap entry under JO-B that would change JO-A's ratio if leaked and verifying JO-A's ratio is unaffected). This is an input-shape test for the service layer, not a defensive filter in the calc.

### 8.6 Riskler ve edge-case'ler

- **Do not use Production's `actualGoodQuantity` as OEE quality input.** Quality is derived in Performance from produced count + quantity adjustments + prorated scrap with reason-driven OEE/non-OEE split. `actualGoodQuantity` is a Production-domain aggregate with different semantics; mixing them would double-count or silently diverge. This constraint is enforced by not importing that field anywhere in Performance's quality path.
- **Scrap prorating is on the clipped job order window only** — never on `productionRunWindows`, never on stop-free windows. Clipping scrap by run/stop state would change the meaning of quality (scrap would disappear during stops even though it physically happened then). Explicit test covers this by scheduling a scrap entry that overlaps a non-effective planned stop inside the JO window: the effective scrap amount is still computed against the full clipped JO window, not the stop-free subset.
- **Unknown reason**: truly unknown (id not in DB) vs referenced soft-deleted (`isActive=false`) — both are "known" for quality purposes; `isActive=false` still resolves flag normally. Only an id that does not resolve at all emits the warning diag.

### 8.7 Done kriteri

- Quality cases pass for all spec rules.
- Diagnostic emission consistent.

---

## Phase 9 — Public APIs + Events + Realtime Forwarding

### 9.1 Amaç

Wire the public OEE API, finalize reason/planned-stop/etc. APIs, emit the required `events.performance` events, ensure realtime forwarding is configured, handle virtual work center composition, and apply user-visibility scoping.

### 9.2 Değişecek dosya/modül türleri

- **New:** `modules/oee/oee.{controller,routes,validators}.ts`, `modules/oee/virtual-work-center.ts`, `virtual-work-center.test.ts`.
- **New:** `lib/internal-api/user.client.ts` (`getUserWorkCenterIds(userId)`) — reuse pattern from Production's existing equivalent if available (cached via `@mes/cache`, invalidated via `events.user` subscriber).
- **Modify:** `jobs/subscribers.ts` — consume `events.user` (`user.updated`) to invalidate auth-context + visibility caches.
- **Modify:** `jobs/subscribers.ts` — consume `events.work_center` to invalidate work-center cache.
- **Modify:** `jobs/events.ts` — finalize emitters for every type per spec.
- **Modify:** `realtime/src/jobs/subscribers.ts` — add `events.performance` entry (already catch-all in pattern; verify).
- **Modify:** `realtime/src/gateway/router.ts` — routing rule for events carrying `workCenterId` → `wc:{workCenterId}` room.

### 9.3 Ön koşullar / dependencies

- Phase 6–8.

### 9.4 Uygulama adımları

1. **OEE validators:**
   ```ts
   oeeQuerySchema = z.object({
     workCenterId: objectIdSchema,
     from: isoUtcInstantSchema,
     to: isoUtcInstantSchema.refine((v, ctx) => v > ctx.from, ...)
   })
   ```
   Reject offset-less / local datetimes.
2. **OEE controller** → `oeeService.calculate({ workCenterId, from, to, userId })`.
3. **OEE service `calculate`:**
   - Visibility: if WC not in `getUserWorkCenterIds(userId)` → 404 (not 403, matches project convention).
   - Otherwise delegate to non-virtual or virtual path.
4. **Virtual WC composition** (`virtual-work-center.ts`):
   - Fetch `metricComposition` (already in `workCenter`).
   - For each contributor `wcId`, call `calculate(wcId, from, to, userId=SYSTEM)` recursively — pass SYSTEM identity (no visibility scoping inside composition).
   - Combine per factor according to `rule`:
     - `primary_work_center`: pick designated first contributor's factor value + status.
     - `average`: arithmetic mean of ratios; if any contributor `not_calculable` → status `not_calculable` for that factor; `no_context` contributors are excluded from denominator if others have context, else `no_context`.
     - `weighted`: `Σ(weight_i × ratio_i) / Σ(weight_i over ok contributors)`; unknown weight defaults to equal weights; same status rules.
   - `oee = availability * productivity * quality` applied post-composition per spec.
   - Diagnostics from each contributor carried forward with `workCenterId` populated.
5. **Response mapper** (`oee.service.ts` → final response):
   - Internal ratios to `percentage = round(ratio * 100)` at the boundary.
   - Clamp negative to `0`; do not cap above `100`.
   - `oee.status = 'not_calculable'` if any factor `not_calculable`; `no_context` if all three `no_context`; `ok` otherwise.
6. **Reason API** - finalize routes (Phase 2 scaffold already written). Verify `?fields=_id` minimal projection.
7. **Planned/Unplanned/Template/Schedule API** — controllers + routes finalized with validators from Phase 3. Visibility: list/create/update enforce `workCenterId ∈ getUserWorkCenterIds(userId)` on public routes; internal routes bypass.
8. **Subscribers:**
   - `events.user` (`user.updated`) → invalidate auth-context cache (identical to Production pattern).
   - `events.work_center` (all types) → invalidate `wc:{id}` cache; on `work_center.updated|archived|deleted` reload monitored-tag map; on `work_center.metric_composition.changed` invalidate composition cache.
   - `events.production` (`job_order.*`, `quantity_adjustment.*`, `scrap_entry.*`, `product_standard.*`) → no cached state to invalidate in v1 (on-demand OEE). Handlers are no-op or log-only (skip registration entirely to save work).
   - `events.telemetry` (`tag.value.recorded`) → run-mode processor (Phase 3).
9. **Emitters** (`jobs/events.ts`):
   - Every mutation (Reason create/update/delete, PlannedStop create/start/close/update, PlannedStopTemplate create/update/delete/start, UnplannedStop open/close/update/convert, PlannedStopSchedule create/update/delete) emits on `events.performance` with a minimal payload that carries **only the routing/identity IDs** — never full documents (see Project Conventions "Event payload rule").
   - Canonical payload shapes:
     - `reason.{created,updated,deleted}` → `{ reasonId }`.
     - `planned_stop.{created,started,closed,updated,deleted}` → `{ plannedStopId, workCenterId }`.
     - `planned_stop_template.{created,updated,deleted,started}` → `{ templateId, workCenterIds, plannedStopId? }` (for `started`).
     - `planned_stop_schedule.{created,updated,deleted}` → `{ scheduleId, workCenterIds }`.
     - `unplanned_stop.{opened,closed,updated,converted}` → `{ unplannedStopId, workCenterId, convertedToPlannedStopId? }`.
     - `policy.updated` → `{ workCenterId: ObjectId | null }` (null = factory default).
     - `oee.recalculated` (if emitted) → `{ workCenterId, from, to }`.
   - `traceId` merged automatically from ALS by the shared `publishEvent(streamClient, 'events.performance', type, data)` helper.
   - **Routing key change handling:** none of these events' routing keys (`workCenterId`) can mutate on their source entity (Project Conventions "Routing key immutability"). Emit helpers therefore do not carry a `previousWorkCenterId`. If a later spec allows moving a stop between work centers, the affected helper gains that parameter per `CLAUDE.md` convention.
10. **Realtime:** `realtime/src/jobs/subscribers.ts` register `'events.performance': { '*': catchAll }`. `router.ts` already routes by `workCenterId` → `wc:{workCenterId}` (verify).
11. **OpenAPI:** register the OEE schema + all stop schemas with `@mes/openapi`.
12. **i18n keys:** add translations for every new `error.*` and `diagnostic.*` key under `performance/src/locales/en.json`, `tr.json` (follow Production's locale layout).

### 9.5 Test planı

- **Unit — virtual-work-center.test:**
  - `primary_work_center` rule picks contributor 0's factor.
  - `average` rule with mixed `ok`/`no_context` excludes `no_context` from denominator.
  - Any contributor `not_calculable` bubbles up for that factor.
  - Recursive virtual WC resolves leaves correctly (3 levels deep).
  - Weighted rule with missing weights equals average.
- **Unit — oee.service.test:**
  - Factor status aggregation into `oee.status`.
  - Visibility: user without WC access → 404.
  - Internal-path recursion for virtual uses SYSTEM identity (no visibility re-check).
- **Unit — subscribers.test:**
  - `user.updated` invalidates auth-context cache.
  - `work_center.updated` invalidates `wc:{id}` cache.
  - `work_center.metric_composition.changed` invalidates composition cache.
- **Integration / supertest** (mongodb-memory-server):
  - `GET /api/v1/oee?workCenterId=...&from=...&to=...` happy path with one JO, no stops, constant speed.
  - `no_job_order_in_range` case.
  - Non-effective planned stop does not reduce availability percentage.
  - MICRO_STOP does not split production run windows.
  - Missing product standard → `not_calculable` productivity + `not_calculable` OEE.
  - Invalid timestamps (missing `Z`) → 400 `error.invalid_datetime`.
- **Performance-sensitive:**
  - Single OEE query with 5 JOs, 20 stops: ≤ 6 HTTP calls (1 work-center, 0 reasons (local), 1 production jobs, 1 standards batch, 1 records batch, 1 telemetry produced or speed batch) + 0 extra per-item.
- **Realtime smoke** (deferred to Phase 10): `planned_stop.started` payload flows through realtime router to `wc:{workCenterId}` room.

### 9.6 Riskler ve edge-case'ler

- **Visibility bypass for virtual composition**: SYSTEM recursion must not leak data to the caller — caller's 404 check happens once at the top. Verify that virtual composition reads are not accidentally re-scoped by visibility mid-flight.
- **Circular virtual composition** (A references B references A): add cycle detection with a `visitedWorkCenterIds` set; cycle → diagnostic `virtual_work_center_cycle` + `not_calculable`.
- **Time window canonicalization**: reject strings without trailing `Z`.
- **Large `workCenterId` room cardinality**: rooms already scale in realtime gateway; no new risk.

### 9.7 Done kriteri

- Full OEE response shape matches spec.
- Virtual WC composition working.
- Events emitted + forwarded to client rooms.
- All public endpoints reachable via Traefik with correct auth.
- Integration tests pass.

---

## Phase 10 — Contract/Integration Tests and Verification

### 10.1 Amaç

Lock the cross-service contracts with real infrastructure (testcontainers Mongo + Redis; live Production & Telemetry stubs), add end-to-end OEE integration tests, run full suite.

### 10.2 Değişecek dosya/modül türleri

- **New:** `performance/src/modules/oee/__contract__/oee.contract.test.ts`.
- **New:** `performance/src/modules/run-mode/__contract__/run-mode.contract.test.ts`.
- **New:** `performance/src/jobs/__contract__/events.contract.test.ts`.
- **New:** `performance/src/test/contract-setup.ts` (testcontainers: Mongo + Redis). Applies `ioredis` option `enableOfflineQueue: false` globally in test setup so any missing-dependency failure surfaces immediately rather than hanging (Project Conventions "Test infrastructure policy").
- **New:** `performance/src/modules/__contract__/datetime-validation.contract.test.ts` — single suite that hits a representative sample of public and internal endpoints (OEE GET, planned-stop POST, unplanned-stop PATCH, produced-summary POST, job-order-records:batch POST) with offset-less datetime strings and asserts 400 `error.invalid_datetime` on each. Replaces per-phase rejection tests.
- **Modify:** `production/src/modules/internal/job-order-records-batch.test.ts`, `product-standard.service.test.ts` — add contract tests.
- **Modify:** `telemetry/src/modules/historian/historian.service.test.ts` — contract tests for multi-window endpoints against real Mongo.
- **Modify:** `realtime/src/jobs/subscribers.test.ts` — add `events.performance` catch-all verification.
- **Modify:** `turbo.json` (root) — ensure `test:contract` pipeline includes performance + affected services. `passWithNoTests` must stay off; an empty suite must fail the pipeline.

### 10.3 Ön koşullar / dependencies

- Phase 1–9 complete.

### 10.4 Uygulama adımları

1. **Contract test bootstrap:** copy Production's `vitest.contract.config.ts` + `test/contract-setup.ts` patterns; use `@mes/testing` utilities for test server factory (`createTestApp({ loaders })`).
2. **OEE contract test:**
   - Testcontainers Mongo 7 + Redis 7.
   - Stub Production + Telemetry + Work Center via a lightweight Express app (or `nock`-like interceptor configured by env override `INTERNAL_API_*=http://localhost:<stub>`).
   - Scenarios:
     1. Single JO, no stops, constant produced counter: response shape = ok, availability=100%, productivity≈100%, quality=100%, oee≈100%.
     2. JO + 10-min OEE-affecting unplanned stop in the middle: availability=(50-10)/50=80% → scaled; response fields match.
     3. JO + 10-min non-effective planned stop: availability=100%.
     4. JO + MICRO_STOP (unreached by query because repo excludes it): no effect on availability or productivity windows.
     5. Missing product standard for JO sub-window: status `not_calculable` for productivity, `not_calculable` for oee.
     6. Virtual WC with 2 contributors (`primary_work_center`): returns contributor 0 values.
     7. Overlapping planned + unplanned historical records: warning diag, normalized output, no double counting.
     8. Converted unplanned stop with linked planned: normalized as planned interval; inherits planned reason flags.
     9. `execution_span` vs `net_run_segments` modes: different productivity results for same data; both correctly computed.
     10. Quantity adjustment decreases `total`; scrap entries with mixed reasons return `oeeAffectingScrap`/`excludedScrap`.
     11. Empty range (no JO): `no_context` factors + diag.
     12. `to <= from`: 400.
     13. Visibility: user without WC access → 404.
3. **Run-mode contract test:**
   - Real Redis streams: XADD a `tag.value.recorded` event to `events.telemetry` with runModeTagId of a monitored WC.
   - Value `< 1`, no active planned stop, `debounceMs=0` → within ~1s an UnplannedStop is persisted.
   - Value `>= 1` afterward → UnplannedStop closes; short duration tagged MICRO_STOP.
   - `debounceMs > 0` and bouncing value `< 1` then `>= 1` within debounce → no stop created (candidate cleared).
   - Reconciler on startup against a cursor that's behind + Telemetry state-durations stub: replays events and persists expected stops.
4. **Events contract test:**
   - `planned_stop.created/started/closed/updated`, `unplanned_stop.*`, etc. each appear on `events.performance` with `workCenterId` populated where applicable.
   - Realtime gateway receives event and emits to `wc:{workCenterId}`.
5. **Run the full suite:**
   - `pnpm build` — clean.
   - `pnpm typecheck` — clean.
   - `pnpm lint` — clean.
   - `pnpm test` (Turborepo) — all unit tests pass in all packages.
   - `pnpm test:contract` — all contract tests pass.
6. **Smoke in Docker Compose:**
   - `docker compose up -d --build`.
   - `POST /api/v1/auth/login` → token.
   - `POST /api/v1/work-centers`, `POST /api/v1/products`, `POST /api/v1/product-standards`, start a job order.
   - `GET /api/v1/oee?workCenterId=...&from=...&to=...` → 200.
   - Open Grafana and verify Loki has logs tagged `service=performance`.
7. **Verification against the spec's "Implementation Checklist":**
   - Reason Policy Validation — ticked.
   - Derived Unplanned State — ticked.
   - Converted Stop Calculation — ticked.
   - OEE Reason Policy Tests — ticked.
   - Scheduled Planned Stop Tests — ticked.
   - Planned Stop Template Tests — ticked.

### 10.5 Test planı

Covered by 10.4. Highlights:

- **Unit:** already covered in Phases 2–9; re-run for regression.
- **Service tests:** memory Mongo, mocked HTTP clients.
- **Contract tests:** testcontainers Mongo + Redis + stubs for Work Center/Production/Telemetry internal APIs.
- **Edge cases** in contract:
  - DST boundary in scheduled planned stop recurrence.
  - Job order crossing midnight / multiple days.
  - Operator starts tea break while unplanned stop is open → unplanned closes at start time; tea break planned stop active.
  - Planned stop outside job order time → audit-only.
  - Planned stop overrun: split_to_unplanned creates correct unplanned overrun interval.
  - No job order + machine stopped: UnplannedStop still persisted but OEE query returns `no_context` for that interval.
- **Performance-sensitive contract tests:**
  - OEE over 24h with ~50 JOs, ~500 stops, 2 tags: p95 response latency < 500ms on dev hardware. If slower, profile — do NOT add caching in v1; instead identify the real bottleneck.
  - ≤ 6 internal HTTP calls per OEE (spy assertion).

### 10.6 Riskler ve edge-case'ler

- **Flaky testcontainers** in Windows dev env: ensure `DOCKER_HOST` configured; fall back to localhost Docker Desktop.
- **Stub drift vs real services**: contract tests run Production and Telemetry stubs; when real service contracts evolve, keep stubs in sync. Consider real service container tests in a later iteration (explicitly out of v1 per "no overengineering").
- **Long test duration**: contract suite may take 60-120s — acceptable given project constraints.

### 10.7 Done kriteri

- All unit + service + contract tests green.
- OEE response shape matches spec exactly.
- Observed HTTP call count matches budget (≤ 6 internal calls per OEE).
- `docker compose up` stack boots with performance service healthy; sample `/api/v1/oee` returns 200 with expected payload.
- Spec's Implementation Checklist items verifiably covered by tests.

---

## Cross-Cutting Acceptance

The feature is complete when:

1. `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:contract` all pass at the root.
2. `docker compose up --build` brings all eight services healthy (user, work-center, production, telemetry, performance, realtime, loki, grafana).
3. A cold boot of `performance` correctly bootstraps MICRO_STOP, recovers missed run-mode transitions via Telemetry state-durations, and starts serving `/api/v1/oee` in under 5 seconds.
4. An OEE query over a 1-hour window with 1 JO + 1 unplanned stop returns a factor breakdown matching hand-calculation with ≤ 3ms internal computation time (after I/O).
5. Every event listed under `events.performance` in the spec is observable in the realtime room `wc:{workCenterId}` for a subscribed client.
6. The spec's Implementation Checklist sections (Reason Policy Validation, Derived Unplanned State, Converted Stop Calculation, OEE Reason Policy Tests, Scheduled Planned Stop Tests, Planned Stop Template Tests) are each represented by named tests in the repo.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-performance-service.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
