# Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both frontends exist as signed-in, realtime-connected shells served by the production stack: the web app lists users at `/`, the operator panel shows a station's running job order at `/operator/`.

**Architecture:** Two Vite single-page apps in `apps/` share three source-only packages: `@mes/api-client` (types generated from the services' OpenAPI documents, plus the HTTP client), `@mes/frontend` (session, realtime, data, domain, time, i18n, version) and `@mes/ui` (tokens and primitives). The apps never import each other; they meet only through the backend. One nginx image serves both behind Traefik.

**Tech Stack:** React 19.3 + React Compiler, Vite 8, TanStack Router / Query 5 / Table 9 / Form 1, Zod 4, Zustand 5, Tailwind CSS 4, shadcn 4 (Base UI), socket.io-client 4.8.4, i18next 27, date-fns 4 + `@date-fns/tz`, openapi-typescript 7 + openapi-fetch + openapi-react-query, Vitest 5 (node and browser projects), Playwright 1.65, Biome 2.4.6, nginx-unprivileged.

**Spec:** `docs/superpowers/specs/2026-11-25-dual-frontend-architecture-design.md`

**Design:** the "Edmes Web App" canvas, https://claude.ai/artifact/AWM1EZsqYUugoxiThFtNRn. This plan takes its tokens, its shell (sidebar, top bar), its list behaviour (filters, sort and page in the URL) and its page states. It does not build the canvas's refresh badge or its session-expired dialog; the spec's sections 7 to 9 say why. Every other screen belongs to a later plan. The canvas is still changing: where a board disagrees with a value below, the board wins and the value is updated in `theme.css`.

## Global Constraints

- Node ≥ 26, pnpm 10.34.8. New dependencies use caret ranges; never bypass `minimumReleaseAge`.
- Dependencies shared by frontend workspaces are declared once in the `catalog:` of `pnpm-workspace.yaml` and referenced as `catalog:`. After `pnpm install`, `pnpm-lock.yaml` has no `file:` entry for `@mes/api-client`, `@mes/frontend` or `@mes/ui`.
- Browser workspaces extend `tsconfig.web.json` and use **extensionless** imports. Node workspaces keep `.js` extensions.
- Frontend packages are source-only: `exports` point at `src`, no `dist`, no build script.
- The apps never import each other. `packages/*` never import from `apps/*`.
- Web app base path `/`; operator panel base path `/operator/`. Token storage keys `edmes.web.token` and `edmes.operator.token`; station key `edmes.operator.station`.
- All URLs are origin-relative (`/api/v1`, `/socket.io`, `/uploads`). No environment-specific value is compiled in except the version string.
- No runtime request leaves the origin: no CDN fonts, scripts or icons.
- Mutations are never retried automatically.
- Only a 401 `auth.unauthenticated` ends a session. A 503, a timeout or a network failure never does.
- A 401 ends the session: the cache is cleared and the login page opens with the current address in `redirect`, so signing in returns to the same view.
- `accessWebApp` and `accessOperatorPanel` decide which app a user may enter. Inside an app, menu items and route guards use the module's `read*` permission; action controls use the permission the endpoint enforces.
- Realtime events refetch only queries that are on screen, only those whose work centers overlap the event's, and at most once per query every two seconds. A query with `meta: { realtime: false }` ignores events and refetches on its own timer. There is no manual refresh control.
- URL search values are plain strings: lists are comma-separated, ranges are `from..to`, the page size is `size`. One function per list maps the URL to the API query.
- Tests: no `passWithNoTests`; no faked backend below the E2E layer; component tests run in Vitest browser mode; unit tests that need HTTP or Socket.io start a real server on port 0.
- Instants on the wire are ISO 8601 UTC with `Z`. Display uses `meta.plantTimezone` from `/users/me`, never the browser timezone.
- The product is not released: no migrations, backfills or compatibility shims.
- Conventional commits with a lowercase subject, ending with the session's attribution trailer.
- Biome formatting (2 spaces, 100 columns, single quotes, no semicolons). UI strings exist in `en` and `tr`.

## Review Focus

1. **User-service or Redis outage while signed in** (REST 503 `auth.unavailable`, socket `connect_error` `auth.unavailable`): the user stays signed in, sees "server unreachable" and the app recovers by itself. Pinned in Tasks 5, 6 and 11.
2. **The socket drops and returns** (a tablet roaming between access points): the rooms are joined again and everything on screen is refetched, because the gateway has no replay. Pinned in Task 6.
3. **The server is upgraded while a tablet keeps running the old bundle**: a failed lazy-chunk load reloads once and never loops; a version mismatch reloads the panel only when it is idle. Pinned in Task 4.
4. **The one-day token expires while someone is working**: the next request or heartbeat returns 401, the login page opens, and after signing in the user is on the same address with the same filters; the operator is back at the same station. Pinned in Tasks 5, 6, 8, 9 and 11.
5. **An operator with no visible work center, or whose station was removed from their visibility**: a clear "no work center assigned" state instead of a spinner, and a stored station that is no longer visible is dropped. Pinned in Tasks 9 and 11.

## File Structure

```
tsconfig.web.json                      base tsconfig for browser workspaces
apps/
  vite.shared.ts                       shared Vite config factory (plugins, proxy, version.json)
  Dockerfile, nginx.conf               one image for both apps
  web/                                 web-app
  operator/                            operator-panel
  ui-e2e/                              ui-e2e (Playwright)
packages/
  api-client/                          @mes/api-client
    openapi/{user,work-center,production}.json
    src/generated/*.d.ts, src/paths.ts, src/client.ts, src/api-error.ts
  frontend/                            @mes/frontend
    src/{domain,time,version,session,realtime,core,i18n}/
    src/data/{user,work-center,production}/
  ui/                                  @mes/ui
    src/styles/{globals.css,theme.css}, src/components/, src/lib/utils.ts
<service>/src/lib/openapi/document.ts  the service's OpenAPI document as a module
<service>/src/scripts/emit-openapi.ts  writes it to packages/api-client/openapi/
```

---

### Task 1: Permissions in `/users/me` and the application privileges

**Files:**
- Modify: `packages/privileges/src/index.ts`
- Modify: `user/src/modules/user/user.types.ts:10-13`, `user/src/modules/user/user.controller.ts:66-80`, `user/src/modules/user/user.openapi.ts`
- Modify: `docs/user/api-contract.md` (the `/users/me` section and the screen-privilege list near L634-684), `CLAUDE.md` (the permission naming line: drop `accessEntityScreen`, add the two application codes)
- Test: `user/src/modules/user/__tests__/user.routes.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/users/me → { data: User, meta: { plantTimezone: string, serverTime: string, permissions: string[] } }`
- Produces: `export const APPLICATION_PRIVILEGES` holding `accessWebApp` (text `Access Web App`) and `accessOperatorPanel` (text `Access Operator Panel`), first in `PRIVILEGES`
- Removes: the 15 codes that end in `Screen` (`accessUsersScreen` … `accessPerformancePolicyScreen`). No route checks them; the only other mentions are `CLAUDE.md`, `docs/user/api-contract.md` and one old plan.
- Produces: `export type PrivilegeCode` from `@mes/privileges`, the union of every `code` literal

- [ ] **Step 1: Write the failing tests** in `user.routes.test.ts`, using that file's existing helpers to create a role, a user and a token

```ts
it('returns the resolved permissions of the caller in meta', async () => {
  // user holds one role with permissions ['readUsers', 'accessWebApp']
  const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  expect([...res.body.meta.permissions].sort()).toEqual(['accessWebApp', 'readUsers'])
  expect(res.body.meta.plantTimezone).toBe(config.PLANT_TIMEZONE)
})

it('returns an empty permission list for a user with no roles', async () => {
  expect(res.body.meta.permissions).toEqual([])
})

it('has the two application privileges and no screen privileges', () => {
  expect(VALID_PRIVILEGE_CODES.has('accessWebApp')).toBe(true)
  expect(VALID_PRIVILEGE_CODES.has('accessOperatorPanel')).toBe(true)
  expect(PRIVILEGES.filter(p => p.code.endsWith('Screen'))).toEqual([])
})
```

- [ ] **Step 2: Run** `pnpm --filter user-service test -- user.routes` — Expected: the three new tests FAIL (`meta.permissions` undefined, privileges missing, screen codes present).
- [ ] **Step 3: Change the privileges and add the type.** Add `APPLICATION_PRIVILEGES`, delete the 15 screen codes, declare the arrays with `as const satisfies readonly Privilege[]` so `code` keeps its literal type, keep `Object.freeze`, and add `export type PrivilegeCode = (typeof PRIVILEGES)[number]['code']`. `VALID_PRIVILEGE_CODES` stays `ReadonlySet<string>`.
- [ ] **Step 4: Return the permissions.** Add `permissions: string[]` to `RuntimeContextResponse`; in `getUser` set `permissions: req.user!.permissions`. Add `meta` to the `/users/me` response schema in `user.openapi.ts`.
- [ ] **Step 5: Run** `pnpm build:packages && pnpm typecheck && pnpm --filter user-service test` — Expected: PASS. The literal types must not break any service; if a service fails to compile, fix the call site, not the type.
- [ ] **Step 6: Update `docs/user/api-contract.md` and `CLAUDE.md`**, then commit

```bash
git add packages/privileges user docs/user/api-contract.md CLAUDE.md
git commit -m "feat: return the caller's permissions and replace screen privileges with app access"
```

---

### Task 1B: Ready-made roles

**Files:**
- Create: `user/src/constants/default-roles.ts`, `user/src/core/loaders/default-roles.ts`
- Modify: `user/src/modules/role/role.model.ts` (two optional fields), `user/src/core/loaders/system-admin.ts` (report whether the system admin role was created in this run), the loader index that calls `ensureSystemAdmin`
- Modify: `docs/user/domain-model.md` (the Role section)
- Test: `user/src/core/loaders/default-roles.test.ts`

**Interfaces:**
- Consumes: `PRIVILEGES`, `PrivilegeCode` (Task 1)
- Produces: Role fields `key?: string` (unique, sparse; the identity of a ready-made role, so renaming it is safe) and `defaultPermissions?: string[]` (the ready-made set as it was when last applied)
- Produces:

```ts
// user/src/constants/default-roles.ts
export interface DefaultRole {
  key: 'planner' | 'shiftSupervisor' | 'quality' | 'operator' | 'viewer'
  name: string
  description: string
  permissions: readonly PrivilegeCode[]
}
export const DEFAULT_ROLES: readonly DefaultRole[]

// user/src/core/loaders/default-roles.ts
export const ensureDefaultRoles = (options: { firstInstall: boolean }): Promise<void>
```

The sets. `READ` stands for every code in `PRIVILEGES` that starts with `read`, computed, so a read privilege added later is included without editing this file.

| key | name | permissions |
|---|---|---|
| `planner` | Planner | `accessWebApp`, `READ`, `writeProductionPlans`, `deleteProductionPlans`, `writeJobOrders`, `deleteJobOrders`, `writeSchedules`, `writeProductStandards`, `deleteProductStandards` |
| `shiftSupervisor` | Shift Supervisor | `accessWebApp`, `accessOperatorPanel`, `READ`, `executeJobOrders`, `writeOperators`, `writeProductionAdjustments`, `createUnplannedStops`, `writeUnplannedStops`, `executeUnplannedStops`, `createPlannedStops`, `writePlannedStops`, `executePlannedStops`, `executePlannedStopTemplates` |
| `quality` | Quality | `accessWebApp`, `READ`, `writeProductionAdjustments`, `deleteProductionAdjustments`, `createReasons`, `writeReasons` |
| `operator` | Operator | `accessOperatorPanel`, `readWorkCenters`, `readSchedules`, `readOperators`, `writeOperators`, `readCatalog`, `readProductStandards`, `readJobOrders`, `executeJobOrders`, `readProductionAdjustments`, `writeProductionAdjustments`, `readReasons`, `readPlannedStops`, `executePlannedStops`, `readPlannedStopTemplates`, `executePlannedStopTemplates`, `readUnplannedStops`, `createUnplannedStops`, `writeUnplannedStops`, `executeUnplannedStops`, `readTags`, `readHistorian`, `readOee` |
| `viewer` | Viewer | `accessWebApp`, `READ` |

Rules:
- `firstInstall` is true only in the run that creates the system administrator role. Only then is a missing ready-made role created, with `defaultPermissions` equal to its `permissions`.
- In every later run, a ready-made role that still exists (found by `key`) receives the codes that are in its definition now and were not in its `defaultPermissions`, added to `permissions` with `$addToSet`; then `defaultPermissions` is set to the current definition. Nothing is ever removed from `permissions`.
- A ready-made role the customer deleted is not created again.
- Writes go through the same path and emit the same `role.created` / `role.updated` events as `ensureSystemAdminRole`, with a log event `bootstrap.default_roles.*`.

- [ ] **Step 1: Write the failing tests** (real MongoDB, as the other loader and service tests in this package)

```ts
it('creates the five roles on first install', async () => {
  await ensureDefaultRoles({ firstInstall: true })
  const keys = (await Role.find({ key: { $exists: true } }).lean()).map(r => r.key).sort()
  expect(keys).toEqual(['operator', 'planner', 'quality', 'shiftSupervisor', 'viewer'])
})
it('gives the operator the panel and not the web app', async () => {
  const operator = await Role.findOne({ key: 'operator' }).lean()
  expect(operator.permissions).toContain('accessOperatorPanel')
  expect(operator.permissions).toContain('readJobOrders')
  expect(operator.permissions).not.toContain('accessWebApp')
})
it('gives the viewer every read privilege and nothing that changes data', async () => {
  const viewer = await Role.findOne({ key: 'viewer' }).lean()
  const reads = PRIVILEGES.map(p => p.code).filter(code => code.startsWith('read'))
  expect([...viewer.permissions].sort()).toEqual(['accessWebApp', ...reads].sort())
})
it('uses only valid privilege codes', () => {
  expect(getInvalidPrivilegeCodes(DEFAULT_ROLES.flatMap(r => [...r.permissions]))).toEqual([])
})
it('does not recreate a role the customer deleted', async () => {
  await Role.deleteOne({ key: 'quality' })
  await ensureDefaultRoles({ firstInstall: false })
  expect(await Role.exists({ key: 'quality' })).toBeNull()
})
it('keeps what the customer removed and renamed', async () => {
  await Role.updateOne({ key: 'planner' }, { $set: { name: 'Planlamacı' }, $pull: { permissions: 'deleteJobOrders' } })
  await ensureDefaultRoles({ firstInstall: false })
  const planner = await Role.findOne({ key: 'planner' }).lean()
  expect(planner.name).toBe('Planlamacı')
  expect(planner.permissions).not.toContain('deleteJobOrders')
})
it('adds a privilege that is new in the definition exactly once', async () => {
  // simulate an older install: the stored snapshot lacks 'readOee'
  await Role.updateOne({ key: 'viewer' }, { $pull: { permissions: 'readOee', defaultPermissions: 'readOee' } })
  await ensureDefaultRoles({ firstInstall: false })
  expect((await Role.findOne({ key: 'viewer' }).lean()).permissions).toContain('readOee')
  // the customer removes it again; the next start leaves it removed
  await Role.updateOne({ key: 'viewer' }, { $pull: { permissions: 'readOee' } })
  await ensureDefaultRoles({ firstInstall: false })
  expect((await Role.findOne({ key: 'viewer' }).lean()).permissions).not.toContain('readOee')
})
```

- [ ] **Step 2: Run** `pnpm --filter user-service test -- default-roles` — Expected: FAIL, the loader does not exist.
- [ ] **Step 3: Implement.** `ensureSystemAdmin` returns `{ roleCreated: boolean }`; the loader index calls `ensureDefaultRoles({ firstInstall: roleCreated })` after it.
- [ ] **Step 4: Run** `pnpm --filter user-service test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Document the two fields and the rules in `docs/user/domain-model.md`**, then commit

```bash
git add user docs/user/domain-model.md
git commit -m "feat: create ready-made roles on first install"
```

---

### Task 2: Build-time OpenAPI documents

**Files:**
- Create: `user/src/lib/openapi/document.ts`, `user/src/scripts/emit-openapi.ts`, `user/src/lib/openapi/document.test.ts`
- Create: `work-center/src/modules/work-center/work-center.openapi.ts`, `work-center/src/lib/openapi/document.ts`, `work-center/src/scripts/emit-openapi.ts`, `work-center/src/lib/openapi/document.test.ts`
- Create: `production/src/modules/job-order/job-order.openapi.ts`, `production/src/lib/openapi/document.ts`, `production/src/scripts/emit-openapi.ts`, `production/src/lib/openapi/document.test.ts`
- Create (generated, committed): `packages/api-client/openapi/{user,work-center,production}.json`
- Modify: `{user,work-center,production}/src/core/loaders/express.ts` (import the document instead of building it inline), each service's `package.json`, root `package.json`, `biome.json`

**Interfaces:**
- Produces: `export const openApiDocument: object` from each `src/lib/openapi/document.ts`
- Produces: script `openapi:emit` in the three services (`tsx src/scripts/emit-openapi.ts`) writing `packages/api-client/openapi/<service>.json` as `JSON.stringify(document, null, 2) + '\n'`
- Produces: root script `"openapi:emit": "pnpm -r --if-present run openapi:emit"`
- Produces: registered paths `GET /work-centers`, `GET /work-centers/{id}`, `GET /job-orders`, `GET /job-orders/{id}`, with response schemas that mirror `work-center.model.ts` and `job-order.model.ts` field for field and query schemas reused from the existing validators (`jobOrderListSchema`)

- [ ] **Step 1: Write the failing tests**

```ts
// user/src/lib/openapi/document.test.ts
it('documents every public route', () => {
  // collect `METHOD /path` from userRoutes, authRoutes, roleRoutes and specialityRoutes
  // (router.stack[].route.path and .methods), rewriting `:id` to `{id}`
  const documented = Object.entries(openApiDocument.paths).flatMap(([path, item]) =>
    Object.keys(item).map(method => `${method.toUpperCase()} ${path}`),
  )
  expect(mounted.filter(route => !documented.includes(route))).toEqual([])
})

// work-center/src/lib/openapi/document.test.ts
it('documents the work center reads', () => {
  expect(Object.keys(openApiDocument.paths)).toEqual(
    expect.arrayContaining(['/work-centers', '/work-centers/{id}']),
  )
})

// production/src/lib/openapi/document.test.ts
it('documents the job order reads and their filters', () => {
  const list = openApiDocument.paths['/job-orders'].get
  const names = list.parameters.map(p => p.name)
  expect(names).toEqual(expect.arrayContaining(['workCenterIds', 'runtimeState', 'page', 'limit']))
})
```

- [ ] **Step 2: Run** `pnpm --filter user-service --filter work-center-service --filter production-service test -- document` — Expected: FAIL, `document.ts` does not exist.
- [ ] **Step 3: Extract the documents.** Move the path merge out of each `express.ts` into `document.ts`; `express.ts` imports `openApiDocument`. Follow `user.openapi.ts` for the two new `*.openapi.ts` files. Use the `{ data, pagination }` and `{ data }` envelopes from `@mes/core/pagination`.
- [ ] **Step 4: Run the tests** — Expected: the work-center and production tests PASS. If the user-service test lists undocumented routes, register them in the matching `*.openapi.ts`; do not exclude them from the test.
- [ ] **Step 5: Add the emit scripts**, then exclude the generated folders from Biome: add `"!packages/api-client/openapi"`, `"!packages/api-client/src/generated"` and `"!**/routeTree.gen.ts"` to `files.includes` in `biome.json`.
- [ ] **Step 6: Run** `pnpm openapi:emit` with no `.env` and no database running — Expected: exit 0 and three JSON files. If a `*.openapi.ts` import reaches `config` or a connection, break that import; the emit must not need a running service.
- [ ] **Step 7: Run** `pnpm openapi:emit && git diff --exit-code packages/api-client/openapi` a second time — Expected: no diff (the output is deterministic).
- [ ] **Step 8: Commit**

```bash
git add user work-center production packages/api-client/openapi package.json biome.json
git commit -m "feat: emit the services' openapi documents at build time"
```

---

### Task 3: Frontend toolchain and `@mes/api-client`

**Files:**
- Create: `tsconfig.web.json`
- Create: `packages/api-client/{package.json,tsconfig.json,vitest.config.ts}`, `src/{index.ts,paths.ts,client.ts,api-error.ts,client.test.ts}`, `src/generated/{user,work-center,production}.d.ts`
- Modify: `pnpm-workspace.yaml` (catalog), `turbo.json`, `package.json` (lint-staged glob gains `tsx`), `biome.json` (`"css": { "parser": { "tailwindDirectives": true } }`), `.github/workflows/ci.yml` (drift check in the `static` job), `CLAUDE.md`

**Interfaces:**
- Consumes: `packages/api-client/openapi/*.json` (Task 2)
- Produces:

```ts
// @mes/api-client
export type paths = UserPaths & WorkCenterPaths & ProductionPaths
export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted'
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number // 0 unless kind is 'http'
  readonly code: string // envelope error.code; 'client.network', 'client.timeout', 'client.aborted', 'client.unexpected_response'
  readonly details?: ReadonlyArray<{ field: string; message: string }>
  readonly traceId?: string // the response's X-Trace-Id header: the "reference" an error state shows
}
export function toApiError(error: unknown): ApiError // total: never throws; a caller's abort error → kind 'aborted'
export function isAbortError(error: unknown): boolean
// A request the caller aborts (a cancelled query) rejects with the original abort error, not an ApiError.
// onUnauthorized is called only for a 401 auth.unauthenticated whose request carried the token that is
// still current: a late answer to an old token, or to a request sent without one, ends nothing.
export interface ApiClientOptions {
  baseUrl?: string // default '/api/v1'
  getToken: () => string | null
  getLocale: () => string
  onUnauthorized: () => void
  timeoutMs?: number // default 15000
}
export interface ApiClient {
  fetchClient: import('openapi-fetch').Client<paths>
  $api: import('openapi-react-query').OpenapiQueryClient<paths>
}
export function createApiClient(options: ApiClientOptions): ApiClient
```

- Produces: script `generate` in `@mes/api-client` (one `openapi-typescript openapi/<service>.json -o src/generated/<service>.d.ts` per service)

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

Catalog entries (floors seen on 2026-11-25): `react` and `react-dom` ^19.3.0, `@types/react` ^19.3.0, `@types/react-dom` ^19.3.0, `@tanstack/react-query` ^5.108.0, `@tanstack/react-router` ^1.170.0, `@tanstack/react-table` ^9.3.0, `@tanstack/react-form` ^1.33.0, `zod` ^4.6.7, `zustand` ^5.1.0, `vite` ^8.3.0, `vitest` ^5.1.0, `@vitest/browser-playwright` ^5.1.0, `vitest-browser-react` ^2.3.0, `tailwindcss` and `@tailwindcss/vite` ^4.3.0.

- [ ] **Step 1: Write the failing tests** in `client.test.ts`. Each test starts a `node:http` server on port 0 that replies as scripted and records the request.

```ts
it('sends the bearer token and the locale', async () => {
  // getToken → 'tkn', getLocale → 'tr'
  expect(seen.headers.authorization).toBe('Bearer tkn')
  expect(seen.headers['accept-language']).toBe('tr')
})
it('sends no Authorization header without a token', ...)
it('rejects a non-2xx with the status, code and details of the envelope', async () => {
  // 400 { error: { code: 'error.validation_failed', message: 'Validation failed',
  //                details: [{ field: 'email', message: 'Invalid email' }] } }
  await expect(call).rejects.toMatchObject({
    kind: 'http', status: 400, code: 'error.validation_failed',
    details: [{ field: 'email', message: 'Invalid email' }],
  })
})
it('carries the trace id of the response', ...) // header X-Trace-Id: 'abc-123' → error.traceId === 'abc-123'
it('calls onUnauthorized once on 401 auth.unauthenticated', ...)
it('does not call onUnauthorized for a 401 from /auth/login', ...)
it('does not call onUnauthorized on 503 auth.unavailable', async () => {
  await expect(call).rejects.toMatchObject({ status: 503, code: 'auth.unavailable' })
  expect(onUnauthorized).not.toHaveBeenCalled()
})
it('maps a refused connection to kind network', ...) // code 'client.network', status 0
it('maps a response slower than timeoutMs to kind timeout', ...) // server waits 200 ms, timeoutMs 50
it('survives a plain-text error body from the gateway', async () => {
  // 502 with body 'Bad Gateway' and content-type text/plain
  await expect(call).rejects.toMatchObject({ status: 502, code: 'client.unexpected_response' })
})
```

- [ ] **Step 2: Create the workspace** (`package.json` with `"exports": { ".": "./src/index.ts" }`, scripts `generate`, `typecheck: tsc --noEmit`, `test: vitest run`), the catalog and `tsconfig.web.json`; run `pnpm install` and `pnpm --filter @mes/api-client generate`.
- [ ] **Step 3: Run** `pnpm --filter @mes/api-client test` — Expected: FAIL, `createApiClient` is not defined.
- [ ] **Step 4: Implement `api-error.ts` and `client.ts`.** One `openapi-fetch` middleware: `onRequest` sets the two headers; `onResponse` throws an `ApiError` for a non-2xx; `onError` returns an `ApiError` for a fetch failure. The timeout comes from a `fetch` wrapper that combines the request signal with `AbortSignal.timeout(timeoutMs)`. `$api` is `createClient(fetchClient)` from `openapi-react-query`.
- [ ] **Step 5: Run** `pnpm --filter @mes/api-client test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 6: Wire the repo.** In `turbo.json` add `src/**/*.tsx`, `src/**/*.css`, `index.html` and `vite.config.ts` to the `build` and `typecheck` inputs and `**/*.tsx`, `**/*.css` to `lint`. Add this step to the `static` CI job: `pnpm openapi:emit && pnpm --filter @mes/api-client generate && git diff --exit-code packages/api-client`. In `CLAUDE.md`: scope the `.js` extension rule to Node workspaces, add the frontend packages to the package table and the commands `pnpm openapi:emit` and `pnpm --filter @mes/api-client generate`.
- [ ] **Step 7: Run** `pnpm lint && grep -nE "file:.*(api-client|frontend|packages/ui)" pnpm-lock.yaml` — Expected: lint clean, grep prints nothing.
- [ ] **Step 8: Commit**

```bash
git add tsconfig.web.json packages/api-client pnpm-workspace.yaml pnpm-lock.yaml turbo.json package.json biome.json .github/workflows/ci.yml CLAUDE.md
git commit -m "feat: add the typed api client and the frontend toolchain"
```

---

### Task 4: `@mes/frontend` — domain, time and version

**Files:**
- Create: `packages/frontend/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `src/domain/{job-order.ts,quantity.ts,index.ts}`, `src/time/{format.ts,server-clock.ts,index.ts}`, `src/version/{version-check.ts,chunk-reload-guard.ts,reload-when-idle.ts,index.ts}`
- Test: one `*.test.ts` beside each source file

**Interfaces:**
- Produces: `package.json` exports `./domain`, `./time`, `./version` → `./src/<name>/index.ts`. Later tasks add `./session`, `./realtime`, `./core`, `./i18n` the same way and `./data/*` → `./src/data/*.ts`, each when its folder is created. `vitest.config.ts` defines two projects: `unit` (node, `src/**/*.test.ts`) and `browser` (Playwright Chromium, `src/**/*.browser.test.tsx`).

```ts
// @mes/frontend/domain
export type JobOrderRuntimeState = 'pending' | 'running' | 'finished'
export function jobOrderRuntimeState(jobOrder: {
  startTime?: string | null
  endTime?: string | null
}): JobOrderRuntimeState
export function goodQuantity(input: { gross: number; scrap: number; adjustments: number }): number

// @mes/frontend/time
export function isUtcInstant(value: string): boolean
export function formatInstant(
  iso: string,
  options: { timeZone: string; locale: string; style: 'date' | 'time' | 'dateTime' },
): string
export function plantLocalToInstant(local: string, timeZone: string): string // 'YYYY-MM-DDTHH:mm' → ISO UTC
export interface ServerClock {
  now(): Date
  toIso(): string
}
export function createServerClock(serverTimeIso: string): ServerClock

// @mes/frontend/version
export function startVersionCheck(options: {
  currentVersion: string
  url: string
  intervalMs?: number // default 300000
  onMismatch: (serverVersion: string) => void
}): { checkNow(): Promise<void>; stop(): void }
export function installChunkReloadGuard(options: {
  storage: Pick<Storage, 'getItem' | 'setItem'> // sessionStorage in the apps
  reload: () => void
  target?: EventTarget // default window; listens for 'vite:preloadError'
}): void
export function reloadWhenIdle(options: {
  isBusy: () => boolean
  reload: () => void
  pollMs?: number // default 5000
}): () => void
```

- [ ] **Step 1: Write the failing tests**

```ts
// domain
expect(jobOrderRuntimeState({})).toBe('pending')
expect(jobOrderRuntimeState({ startTime: '2026-04-04T12:30:00.000Z' })).toBe('running')
expect(jobOrderRuntimeState({ startTime: '2026-04-04T12:30:00.000Z', endTime: '2026-04-04T13:00:00.000Z' })).toBe('finished')
expect(goodQuantity({ gross: 1000, scrap: 40, adjustments: -10 })).toBe(950)

// time
expect(isUtcInstant('2026-04-04T12:30:00.000Z')).toBe(true)
expect(isUtcInstant('2026-04-04T12:30:00')).toBe(false)
expect(formatInstant('2026-04-04T12:30:00.000Z', { timeZone: 'Europe/Istanbul', locale: 'tr', style: 'time' })).toBe('15:30')
expect(plantLocalToInstant('2026-04-04T15:30', 'Europe/Istanbul')).toBe('2026-04-04T12:30:00.000Z')
// a local time that does not exist (clocks go forward) resolves forward
expect(plantLocalToInstant('2026-03-29T02:30', 'Europe/Berlin')).toBe('2026-03-29T01:30:00.000Z')
// a local time that happens twice (clocks go back) resolves to the first
expect(plantLocalToInstant('2026-10-25T02:30', 'Europe/Berlin')).toBe('2026-10-25T00:30:00.000Z')

// server clock: the tablet is two minutes behind the server
vi.setSystemTime(new Date('2026-04-04T11:58:00.000Z'))
const clock = createServerClock('2026-04-04T12:00:00.000Z')
vi.advanceTimersByTime(1000)
expect(clock.toIso()).toBe('2026-04-04T12:00:01.000Z')

// version (a node:http server serves /version.json)
it('reports a different server version once', ...) // { version: '1.1.0' } against currentVersion '1.0.0':
// three checks in a row call onMismatch once in total; a later '1.2.0' calls it once more
it('stays silent when the version matches', ...)
it('stays silent when the server is down or answers with HTML', ...) // closed port; 502 text/html
it('reloads once on a failed chunk load and never loops', () => {
  target.dispatchEvent(new Event('vite:preloadError'))
  target.dispatchEvent(new Event('vite:preloadError'))
  expect(reload).toHaveBeenCalledTimes(1)
})
it('reloads only after the app stops being busy', ...) // isBusy true for two polls, then false → reload once
```

- [ ] **Step 2: Run** `pnpm --filter @mes/frontend test` — Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** the three folders. The chunk reload guard's mark in `storage` is never cleared: one reload per tab session, and a later upgrade is the version check's job. Time uses `date-fns` and `@date-fns/tz`; `formatInstant` uses `Intl.DateTimeFormat` with `timeZone`. `startVersionCheck` fetches with `cache: 'no-store'`.
- [ ] **Step 4: Run** `pnpm --filter @mes/frontend test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/frontend pnpm-lock.yaml
git commit -m "feat: add shared domain, time and version modules for the frontends"
```

---

### Task 5: Session store

**Files:**
- Create: `packages/frontend/src/session/{session-store.ts,index.ts}`
- Test: `packages/frontend/src/session/session-store.test.ts`

**Interfaces:**
- Consumes: `ApiClient`, `ApiError` (Task 3); `createServerClock` (Task 4); `PrivilegeCode` (Task 1)
- Produces:

```ts
// @mes/frontend/session
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous' | 'unreachable'
export type SessionUser = /* the generated `data` type of GET /users/me */
export interface SessionState {
  status: SessionStatus
  user: SessionUser | null
  permissions: readonly string[]
  plantTimezone: string | null
  serverClock: ServerClock | null
}
export type TokenStorageKey = 'edmes.web.token' | 'edmes.operator.token'
export interface SessionStore {
  getState(): SessionState
  subscribe(listener: (state: SessionState) => void): () => void
  getToken(): string | null // reads storage on every call; no in-memory copy
  bootstrap(): Promise<void>
  login(credentials: { email: string; password: string }): Promise<void> // rejects with ApiError
  refresh(): Promise<void>
  logout(): void // → 'anonymous'; user, permissions and token dropped. Also what a 401 calls.
  can(code: PrivilegeCode): boolean
}
export function createSessionStore(options: {
  storageKey: TokenStorageKey
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  api: () => ApiClient // lazy, because the client's callbacks point back at this store
}): SessionStore
```

- [ ] **Step 1: Write the failing tests.** A `node:http` server scripts `/auth/login` and `/users/me`; storage is a `Map`-backed object.

```ts
it('is anonymous without a stored token and makes no request', ...)
it('becomes authenticated from a stored token', async () => {
  // /users/me → 200 with meta { plantTimezone: 'Europe/Istanbul', serverTime, permissions: ['readUsers'] }
  expect(store.getState()).toMatchObject({
    status: 'authenticated', plantTimezone: 'Europe/Istanbul', permissions: ['readUsers'],
  })
})
it('drops the token on 401', async () => {
  expect(store.getState().status).toBe('anonymous')
  expect(storage.getItem('edmes.web.token')).toBeNull()
})
it('keeps the token when user-service answers 503 auth.unavailable', async () => {
  expect(store.getState().status).toBe('unreachable')
  expect(storage.getItem('edmes.web.token')).toBe('tkn')
})
it('keeps the token when the server cannot be reached', ...) // closed port → 'unreachable'
it('recovers from unreachable on the next bootstrap', ...) // 503 then 200 → 'authenticated'
it('stores the token under its own key only', async () => {
  // storageKey 'edmes.operator.token'
  expect(storage.getItem('edmes.operator.token')).toBe('tkn')
  expect(storage.getItem('edmes.web.token')).toBeNull()
})
it('rejects a wrong password and stores nothing', ...) // 401 → ApiError; status stays 'anonymous'
it('surfaces the lockout code', ...) // 429 → ApiError code 'auth.account_temporarily_locked'
it('ends the session when a later request returns 401', async () => {
  // authenticated; the next request answers 401, so the client calls store.logout()
  expect(store.getState()).toMatchObject({ status: 'anonymous', user: null, permissions: [] })
  expect(storage.getItem('edmes.web.token')).toBeNull()
})
it('ends the session when a refresh returns 401', ...) // the heartbeat path: status 'anonymous', token removed
it('grants a held permission, refuses a missing one and honours the wildcard', () => {
  // permissions ['readUsers'] → can('readUsers') true, can('writeUsers') false; ['*'] → true
})
it('picks up changed permissions on refresh', ...)
it('keeps the user and the permissions when a refresh fails without a 401', async () => {
  // authenticated, then /users/me answers 503 (or 404 HTML from the gateway, or nothing at all)
  await store.refresh()
  expect(store.getState()).toMatchObject({ status: 'unreachable', permissions: ['readUsers'] })
  expect(store.getState().user).not.toBeNull()
  // the next refresh answers 200
  await store.refresh()
  expect(store.getState().status).toBe('authenticated')
})
// compile-time
// @ts-expect-error a misspelled privilege code does not compile
store.can('accessUserScreen')
```

- [ ] **Step 2: Run** `pnpm --filter @mes/frontend test -- session` — Expected: FAIL.
- [ ] **Step 3: Implement** with a Zustand vanilla store. `bootstrap` and `refresh` call `GET /users/me`; only an `ApiError` with status 401 and code `auth.unauthenticated` clears the token. Any other failure sets `unreachable` and leaves the user, permissions and token as they were. A 401 `auth.unauthenticated` from `bootstrap`, from `refresh` or from any later request ends in `anonymous`; a 401 with another code (a wrong password at `/auth/login`) is only the error of that request.
- [ ] **Step 4: Run** `pnpm --filter @mes/frontend test -- session && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/frontend
git commit -m "feat: add the frontend session store"
```

---

### Task 6: Realtime client and app core

**Files:**
- Create: `packages/frontend/src/realtime/{realtime-client.ts,invalidation.ts,index.ts}`
- Create: `packages/frontend/src/core/{create-app-core.ts,react.tsx,index.ts}`
- Test: `src/realtime/realtime-client.test.ts`, `src/core/create-app-core.test.ts`

**Interfaces:**
- Consumes: `SessionStore` (Task 5), `createApiClient`, `toApiError` (Task 3)
- Produces:

```ts
// @mes/frontend/realtime
export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unavailable'
export type InvalidationMap = Readonly<Record<string, readonly string[]>> // event entity → API path prefixes
export const invalidationMap: InvalidationMap = {
  user: ['/users'],
  role: ['/roles', '/users'],
  speciality: ['/specialities', '/users'],
  work_center: ['/work-centers'],
  job_order: ['/job-orders'],
}
export function pathsForEvent(eventType: string, map: InvalidationMap): readonly string[]
export function eventWorkCenterIds(payload: Record<string, unknown>): string[]
// from workCenterId, previousWorkCenterId and workCenterIds[]; [] when the event names none
export function queryWorkCenterIds(queryKey: QueryKey): string[] | null
// from the key's params: path.workCenterId, query.workCenterId, query.workCenterIds (comma list);
// null when the query is not about specific work centers
export interface RealtimeClient {
  start(): void
  stop(): void
  getStatus(): RealtimeStatus
  getStatusSince(): Date // when the current status began
  onStatus(listener: (status: RealtimeStatus) => void): () => void
  retryNow(): void
  subscribe(rooms: readonly string[]): () => void // reference-counted
  on(eventType: string, handler: (payload: Record<string, unknown>) => void): () => void
}
export function createRealtimeClient(options: {
  url?: string // default: the page origin
  getToken: () => string | null
  queryClient: QueryClient
  invalidation: InvalidationMap
  onUnauthenticated: () => void
  onRoomsDenied?: (denied: string[]) => void
  retryDelayMs?: number // default 2000
  throttleMs?: number // default 2000; the shortest gap between two event-driven refetches of one query
}): RealtimeClient

// @mes/frontend/core
export interface AppCore {
  api: ApiClient
  session: SessionStore
  queryClient: QueryClient
  realtime: RealtimeClient
}
export function createAppCore(options: {
  app: 'web' | 'operator'
  storage: Storage
  getLocale: () => string
  realtimeUrl?: string
  apiBaseUrl?: string
  heartbeatMs?: number // default 30000
}): AppCore
export function AppCoreProvider(props: { core: AppCore; children: ReactNode }): ReactNode
export function useAppCore(): AppCore
export function useSession(): SessionState
export function useCan(): (code: PrivilegeCode) => boolean
export function useRealtimeStatus(): { status: RealtimeStatus; since: Date }
export function useRealtimeRooms(rooms: readonly string[]): void
```

Rules the signatures do not fix:
- The socket connects with `{ transports: ['websocket'], autoConnect: false, auth: cb => cb({ token: getToken() }) }`.
- The event entity is the text before the first dot: `pathsForEvent('work_center.shift.started', map)` returns `map.work_center`.
- A query **matches** an event when all of these hold:
  1. `queryKey[0] === 'get'` and `queryKey[1]` equals a mapped path or starts with `<path>/` (the key shape of `openapi-react-query` is `[method, path, init]`);
  2. `query.meta?.realtime !== false`;
  3. either `eventWorkCenterIds(payload)` is empty, or `queryWorkCenterIds(queryKey)` is `null`, or the two lists share an id.
- A matched query is refetched through `queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' })`: an observed query refetches, an unobserved one is only marked stale.
- Refetches are throttled per `queryHash`: the first match invalidates at once; matches during the next `throttleMs` are collapsed into one invalidation at the end of that window.
- `subscribe` and its unsubscribe emit one `join { rooms }` with the full union, coalesced per microtask. Every `connect` emits it again.
- Every `connect` invalidates every active query, including those with `realtime: false`, unthrottled and after the join is acknowledged; the one exception is a connect that succeeds on the very first attempt after `start()`. A first connect that comes late (the gateway was down or answered `auth.unavailable`) missed events too.
- An event-driven refetch never aborts a fetch that is already running (`cancelRefetch: false`); a change that arrives while a fetch runs causes one more refetch when that fetch settles.
- `connect_error` with message `auth.unauthenticated` calls `onUnauthenticated` and stops. `auth.unavailable` sets status `unavailable` and calls `socket.connect()` again after `retryDelayMs`; `retryNow()` does it at once. A `disconnect` with reason `io server disconnect` calls `socket.connect()`.
- `createAppCore` passes `session.logout` as the API client's `onUnauthorized` and as the realtime client's `onUnauthenticated`. It starts the realtime client when the session becomes `authenticated`; when it becomes `anonymous` it stops the client and calls `queryClient.clear()`. A `role.*` event whose `roleId` is one of the signed-in user's roles, and a `user.updated` whose `userId` is the signed-in user, calls `session.refresh()`; an event about another role or user does not. While the status is `authenticated` or `unreachable`, the core calls `session.refresh()` every `heartbeatMs`; this is how an outage and an expired token are noticed on a screen nobody is touching. Query defaults: `staleTime: 30_000`; queries retry twice only when `toApiError(error).kind` is `'network'` or `'timeout'`; `mutations: { retry: false }`.

- [ ] **Step 1: Write the failing tests.** Each test starts a real `socket.io` server (`transports: ['websocket']`) on port 0 whose `join` handler replaces the socket's rooms and acks `{ rooms }`, as the gateway does.

```ts
it('joins the union of the subscribed rooms', async () => {
  client.subscribe(['wc:a'])
  client.subscribe(['wc:b', 'job_order'])
  expect([...lastJoin.rooms].sort()).toEqual(['job_order', 'wc:a', 'wc:b'])
})
it('keeps a room until its last subscriber leaves', ...)
it('invalidates the queries an event maps to and no others', async () => {
  // active queries ['get', '/job-orders', {}], ['get', '/job-orders/{id}', { params: { path: { id: 'j1' } } }]
  // and ['get', '/users', {}]; the server emits 'job_order.started'
  expect(queryClient.getQueryState(jobOrdersKey)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(jobOrderKey)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(usersKey)?.isInvalidated).toBe(false)
})
it('refetches only the queries of the work center the event names', async () => {
  // observed: ['get', '/job-orders', { params: { query: { workCenterIds: 'wc1' } } }]  (keyWc1)
  //           ['get', '/job-orders', { params: { query: { workCenterIds: 'wc2,wc3' } } }]  (keyWc23)
  //           ['get', '/job-orders', { params: { query: { page: 1 } } }]  (keyAll: no work-center scope)
  // each queryFn counts its calls; the server emits 'job_order.started' { jobOrderId: 'j1', workCenterId: 'wc2' }
  expect(calls).toEqual({ keyWc1: 1, keyWc23: 2, keyAll: 2 })
})
it('treats a moved job order as a change to both work centers', ...)
// 'job_order.updated' { workCenterId: 'wc1', previousWorkCenterId: 'wc2' } → keyWc1 and keyWc23 both refetch
it('collapses a burst of events into two refetches', async () => {
  // throttleMs 200; the server emits 'user.updated' ten times within 50 ms
  await vi.waitFor(() => expect(usersCalls).toBe(3)) // the first load, the leading refetch, the trailing one
  await new Promise(resolve => setTimeout(resolve, 400))
  expect(usersCalls).toBe(3)
})
it('never refetches a query that opted out', ...)
// observed with meta { realtime: false }: ten matching events → its queryFn was called once (the first load)
it('does not fetch a query nobody observes', ...)
// cached but unobserved: after an event its queryFn count is unchanged and isInvalidated is true
it('rejoins and refetches everything on screen after the connection drops', async () => {
  serverSocket.conn.close()
  // after the reconnect: a second join with the same rooms, and every observed query was called once more,
  // the opted-out one included
})
it('reports when the current status began', ...) // getStatusSince() moves when 'live' becomes 'reconnecting'
it('retries at once on retryNow', ...) // status 'unavailable', retryDelayMs 60000 → retryNow() connects immediately
it('reports auth.unauthenticated and stops connecting', ...) // onUnauthenticated once; no attempt in 3 × retryDelayMs
it('stays signed in and retries on auth.unavailable', async () => {
  // the middleware rejects twice with 'auth.unavailable', then accepts
  expect(onUnauthenticated).not.toHaveBeenCalled()
  expect(statuses).toEqual(expect.arrayContaining(['unavailable', 'live']))
})
it('reconnects after a server-side disconnect', ...) // serverSocket.disconnect(true) → a new connection
it('reports the rooms the gateway refused', ...) // ack { rooms: ['job_order'] } for ['job_order', 'wc:x'] → onRoomsDenied(['wc:x'])
it('sends the current token on every handshake', ...) // the token changes between two connections
it('ignores an event with no mapping', ...)

// create-app-core.test.ts
it('clears cached data when the session ends', ...) // logout or a 401: the next user of a shared computer sees nothing of the previous one
it('refreshes the session when one of the user\'s roles changes', ...)
// 'role.updated' { roleId: a role the user holds } → a second GET /users/me; { roleId: another role } → none
it('notices an outage and the recovery by itself', async () => {
  // heartbeatMs 50; /users/me answers 200, then 503 twice, then 200
  expect(statuses).toEqual(['authenticated', 'unreachable', 'authenticated'])
})
it('ends the session when the heartbeat gets a 401', ...) // the token ran out while the screen was idle → 'anonymous'
it('never retries a mutation', ...) // a POST answering 500 is requested exactly once
```

- [ ] **Step 2: Run** `pnpm --filter @mes/frontend test -- realtime core` — Expected: FAIL.
- [ ] **Step 3: Implement** the two folders (`socket.io` ^4.8.4 is a devDependency for the tests; `socket.io-client` ^4.8.4 is a dependency).
- [ ] **Step 4: Run** `pnpm --filter @mes/frontend test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/frontend pnpm-lock.yaml
git commit -m "feat: add the realtime client and the shared app core"
```

---

### Task 7: `@mes/ui` — tokens and primitives

**Files:**
- Create: `packages/ui/{package.json,tsconfig.json,components.json,vitest.config.ts}`
- Create: `src/styles/{globals.css,theme.css}`, `src/lib/utils.ts`, `src/test/setup.ts`
- Create with the shadcn CLI (`pnpm dlx shadcn@latest add`): `button`, `input`, `label`, `dialog`, `popover`, `dropdown-menu`, `sonner`, `skeleton` into `src/components/`, then restyle each to the matching rule of the canvas's `edmes.css` (`.bt`, `.in`, `.lb`, `.dg`, `.pop`, `.am`, `.sk`)
- Create: `src/components/{connection-indicator,state-pill,banner}.tsx`
- Test: `src/components/{button,connection-indicator,state-pill}.browser.test.tsx`

**Interfaces:**
- Produces: `package.json` exports `./globals.css`, `./components/*` → `./src/components/*.tsx`, `./lib/*` → `./src/lib/*.ts`
- Produces: `components.json` with `"style": "base-nova"`, `"rsc": false`, `"tailwind": { "config": "", "css": "src/styles/globals.css", "cssVariables": true }`, `"iconLibrary": "lucide"`, aliases under `@mes/ui/...`
- Produces: `Button` with variants `default | primary | danger | danger-solid | ghost` and sizes `default` (36 px) and `sm` (28 px), as `.bt`, `.bt.p`, `.bt.d`, `.bt.dp`, `.bt.g`, `.bt.s`; and a `pending?: boolean` prop: disabled, `aria-busy="true"`, spinner shown
- Produces: `ConnectionIndicator(props: { status: 'live' | 'reconnecting' | 'offline'; label: string })`, rendered with `role="status"` (the canvas's `.cn.live`, `.cn.re`, `.cn.off`)
- Produces: `StatePill(props: { state: 'running' | 'unplanned' | 'planned' | 'idle'; children: ReactNode })`, tone and shape per state, with `data-shape` of `play | octagon | pause | ring` (`.st-run`, `.st-unp`, `.st-pln`, `.st-idl`). The canvas's fifth state, offline (`.st-off`), is not built.
- Produces: `Banner(props: { tone: 'info' | 'warn' | 'error' | 'ok'; role?: 'status' | 'alert'; children: ReactNode })` (`.bn`)
- Produces: tokens in `theme.css`, copied from the `:root, .ed` rule of the canvas's `project/edmes.css` as read on 2026-11-25:

| Token | Value | Canvas name |
|---|---|---|
| `--color-ink`, `--color-ink-2` | `#0F1B2D`, `#263A5C` | `--ink`, `--ink2` |
| `--color-ink-text`, `--color-ink-text-2` | `#C9D2DE`, `#92A2B9` | `--ink-t`, `--ink-t2` |
| `--color-bg`, `--color-surface`, `--color-surface-2` | `#F3F5F8`, `#FFFFFF`, `#F7F8FA` | `--bg`, `--sf`, `--sf2` |
| `--color-line`, `--color-line-2`, `--color-border` | `#DCE1E8`, `#EBEEF3`, `#8792A2` | `--ln`, `--ln2`, `--bd` |
| `--color-text`, `--color-text-2`, `--color-text-3` | `#16202E`, `#465264`, `#5F6A7A` | `--tx`, `--tx2`, `--tx3` |
| `--color-accent`, `-hover`, `-bg`, `-line` | `#2456D6`, `#1B45B0`, `#E9EFFD`, `#B4C6F4` | `--ac`, `--ac-h`, `--ac-bg`, `--ac-ln` |
| `--color-state-running`, `-fg`, `-bg` | `#1E8A55`, `#17663F`, `#E3F4EA` | `--run*` |
| `--color-state-unplanned`, `-fg`, `-bg` | `#D03B28`, `#A82A1B`, `#FDE8E4` | `--unp*` |
| `--color-state-planned`, `-fg`, `-bg` | `#E0A100`, `#8A5300`, `#FFF1CC` | `--pln*` |
| `--color-state-idle`, `-fg`, `-bg` | `#8A94A3`, `#465264`, `#EBEEF2` | `--idl*` |
| `--color-oee-availability`, `-light` | `#0284C7`, `#38BDF8` | `--oa`, `--oa-l` |
| `--color-oee-productivity`, `-light` | `#D97706`, `#FBBF24` | `--op`, `--op-l` |
| `--color-oee-quality`, `-light` | `#059669`, `#34D399` | `--oq`, `--oq-l` |
| `--radius-control` | `6px` | `--r` |
| `--control-h`, `--control-h-sm` | `2.25rem`, `1.75rem`; `3.5rem`, `3rem` under `[data-density='touch']` | `.bt`, `.bt.s` |
| `--font-sans` / `--font-display` / `--font-mono` | Barlow / Barlow Semi Condensed / IBM Plex Mono, from `@fontsource/barlow`, `@fontsource/barlow-semi-condensed`, `@fontsource/ibm-plex-mono` | `--f`, `--fd`, `--fm` |

Base text is 14 px / 1.45 with tabular numerals (`.ed`).

- [ ] **Step 1: Write the failing tests** (browser project; `src/test/setup.ts` imports `globals.css` and removes `data-density` from `<html>` after each test)

```tsx
it('is 36 px tall by default and 56 px in touch density', async () => {
  const screen = await render(<Button>Save</Button>)
  expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(36)
  document.documentElement.dataset.density = 'touch'
  expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(56)
})
it('cannot be activated while pending', async () => {
  const onClick = vi.fn()
  const screen = await render(<Button pending onClick={onClick}>Save</Button>)
  await expect.element(screen.getByRole('button')).toBeDisabled()
  await expect.element(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  await screen.getByRole('button').click({ force: true })
  expect(onClick).not.toHaveBeenCalled()
})
it('announces the connection state', async () => {
  const screen = await render(<ConnectionIndicator status='offline' label='Offline since 10:31' />)
  await expect.element(screen.getByRole('status')).toHaveTextContent('Offline since 10:31')
})
it('gives every state its own shape, so color is never the only signal', async () => {
  // render the four states; collect each pill's data-shape
  expect(shapes).toEqual(['play', 'octagon', 'pause', 'ring'])
})
```

- [ ] **Step 2: Create the workspace**, run the shadcn CLI for the listed components, run `pnpm exec playwright install chromium`.
- [ ] **Step 3: Run** `pnpm --filter @mes/ui test` — Expected: FAIL (no `pending` prop, no indicator or pill, heights not token-driven).
- [ ] **Step 4: Write `theme.css`** (`@theme` block with the tokens, the density override, the font imports), make the control components use `h-(--control-h)`, restyle the generated components, and add `pending`, `ConnectionIndicator`, `StatePill` and `Banner`.
- [ ] **Step 5: Run** `pnpm --filter @mes/ui test && pnpm typecheck && pnpm lint` — Expected: PASS; Biome accepts the `@theme` file.
- [ ] **Step 6: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat: add the shared ui package with tokens and primitives"
```

---

### Task 8: Web app shell and the users list

**Files:**
- Create: `apps/vite.shared.ts`
- Create: `apps/web/{package.json,index.html,vite.config.ts,tsconfig.json,vitest.config.ts,components.json}`
- Create: `apps/web/src/{main.tsx,router.tsx,app.css,navigation.ts,safe-redirect.ts,prefs.ts}`, `src/locales/{en,tr}.ts`
- Create: `apps/web/src/routes/{__root.tsx,login.tsx,_app.tsx,_app/index.tsx,_app/users/index.tsx}`
- Create: `apps/web/src/components/{app-sidebar.tsx,topbar.tsx,page-state.tsx,data-table.tsx,form.tsx}`
- Create: `apps/web/src/features/auth/login-form.tsx`, `apps/web/src/features/users/{users-page.tsx,users-table.tsx}`
- Create: `packages/frontend/src/data/user/users.ts`, `packages/frontend/src/i18n/{index.ts,common.en.ts,common.tr.ts,resolve-language.ts}`
- Test: `apps/web/src/{navigation,safe-redirect,prefs}.test.ts`, `apps/web/src/features/users/users-table.browser.test.tsx`, `apps/web/src/features/auth/login-form.browser.test.tsx`, `apps/web/src/components/page-state.browser.test.tsx`, `packages/frontend/src/data/user/users.test.ts`, `packages/frontend/src/i18n/resolve-language.test.ts`

Design boards this task builds: `Sidebar`, `Topbar`, `SignIn` (default, wrong password, locked), `Users` (the list only), `States`. `JobOrders` is the reference for how any list behaves, without its refresh badge.

**Interfaces:**
- Consumes: `createAppCore`, `AppCoreProvider`, `useSession`, `useCan`, `useRealtimeRooms` (Task 6); `startVersionCheck`, `installChunkReloadGuard` (Task 4); `@mes/ui` (Task 7)
- Produces:

```ts
// apps/vite.shared.ts
export function sharedConfig(options: { root: string; base: '/' | '/operator/'; port: number }): UserConfig
// plugins in order: tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(),
// babel({ presets: [reactCompilerPreset()] }), tailwindcss(), and a plugin that emits
// version.json as { "version": process.env.EDMES_VERSION ?? 'dev' };
// define __APP_VERSION__; server.proxy for /api, /uploads and /socket.io (ws: true) → http://localhost

// @mes/frontend/data/user/users
export const usersListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  size: z.union([z.literal(20), z.literal(50), z.literal(100)]).catch(20), // the design's rows per page
  sort: z.string().optional(),
  search: z.string().max(100).optional(),
})
export type UsersListSearch = z.infer<typeof usersListSearchSchema>
export function toUsersQuery(search: UsersListSearch): { page: number; limit: number; sort?: string; search?: string }
export function usersListOptions(api: ApiClient, search: UsersListSearch)
// $api.queryOptions('get', '/users', { params: { query: toUsersQuery(search) } }, { placeholderData: keepPreviousData })
// keepPreviousData: a refetch or a page change keeps the rows on screen until the new ones arrive

// @mes/frontend/i18n
export type Language = 'en' | 'tr'
export function resolveLanguage(input: { user?: string; stored?: string | null; browser?: string }): Language
export function createI18n(options: { language: Language; resources: Record<Language, object> }): i18n

// apps/web/src/navigation.ts
export interface NavItem { id: string; to: string; labelKey: string; permission: PrivilegeCode }
export interface NavGroup { id: string; labelKey: string; icon: LucideIcon; items: readonly NavItem[] }
export const navigation: readonly NavGroup[]
// the design's six groups arrive with their features; this task ships one:
// { id: 'system', labelKey: 'nav.system', items: [{ id: 'users', to: '/users', labelKey: 'nav.users', permission: 'readUsers' }] }
export function visibleNavigation(can: (code: PrivilegeCode) => boolean): readonly NavGroup[] // a group with no visible item is dropped

// apps/web/src/safe-redirect.ts
export function safeRedirect(target: unknown): string

// apps/web/src/prefs.ts — device-local, one record per user: key 'edmes.web.prefs.<userId>'
export interface WebPrefs { sidebar: 'full' | 'rail' }
export function readPrefs(storage: Pick<Storage, 'getItem'>, userId: string): WebPrefs // default { sidebar: 'full' }
export function writePrefs(storage: Pick<Storage, 'setItem'>, userId: string, prefs: WebPrefs): void

// apps/web/src/components/page-state.tsx
export function PageError(props: { title: string; message: string; traceId?: string; onRetry: () => void }): ReactNode
export function NoPermission(props: { title: string; message: string; onSignOut?: () => void }): ReactNode
export function EmptyState(props: { title: string; message: string; action?: ReactNode }): ReactNode

// apps/web/src/features/users/users-table.tsx
export function UsersTable(props: {
  rows: readonly User[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  onPageChange: (page: number) => void
  onSizeChange: (size: 20 | 50 | 100) => void
}): ReactNode
// apps/web/src/features/auth/login-form.tsx
export function LoginForm(props: { onSubmit: (credentials: { email: string; password: string }) => Promise<void> }): ReactNode
```

Routing rules:
- Router context is `{ core: AppCore }`. `_app` `beforeLoad`: status `anonymous` → `redirect({ to: '/login', search: { redirect: location.href } })`. Status `unreachable` never redirects to login: with a user in the session the layout keeps rendering and shows a banner with `role="status"` and the text of `common.unreachable` ("Server unreachable, retrying"); without a user (the page was loaded during an outage) it shows the same message full-screen and calls `session.bootstrap()` every 5 s.
- `apps/web/turbo.json` extends the root config (`"extends": ["//"]`) and adds `$TURBO_ROOT$/packages/api-client/src/**`, `$TURBO_ROOT$/packages/frontend/src/**` and `$TURBO_ROOT$/packages/ui/src/**` to the `build` inputs, because the shared packages have no build of their own.
- When the session becomes `anonymous` while a page is open (a 401, or Log out), the router is invalidated so the same guard runs and the login page opens with the current address in `redirect`; `login.tsx` navigates to `safeRedirect(search.redirect)` after signing in.
- A signed-in user without `accessWebApp` gets `NoPermission` in place of the shell, saying the account has no access to the web app, with `onSignOut`.
- `_app` renders the shell: `AppSidebar` (groups from `visibleNavigation`, collapsible to the rail, the choice kept with `writePrefs`; below 1100 px it starts as the rail) and `Topbar` (a `ConnectionIndicator`, the plant clock from `serverClock` in `plantTimezone`, the user menu with Log out). Indicator status: session `unreachable` or realtime `unavailable` → `offline`, with the label "Offline since HH:mm" from the time that state began; `connecting` or `reconnecting` → `reconnecting`; otherwise `live`.
- `_app/users` `beforeLoad`: without `readUsers`, render `NoPermission`.
- `/users` validates its search with `usersListSearchSchema`; page, size, sort and search live in the URL only.
- `users-page.tsx` calls `useRealtimeRooms(['user'])`; the list then follows `user.*` events by itself under the realtime client's throttle. The first load shows skeleton rows; a later refetch or page change keeps the current rows until the new ones arrive; a failed load shows `PageError` with the error's `traceId`.
- `main.tsx` calls `installChunkReloadGuard` with `sessionStorage` and `startVersionCheck({ currentVersion: __APP_VERSION__, url: '/version.json', onMismatch })`, where `onMismatch` shows a toast with a reload action.
- `components/form.tsx` exports `useAppForm` from `createFormHook`, bound to `TextField` and `SubmitButton` built on `@mes/ui`.

- [ ] **Step 1: Write the failing tests**

```ts
// navigation.test.ts
expect(visibleNavigation(() => false)).toEqual([]) // no item, so no group either
expect(visibleNavigation(code => code === 'readUsers').flatMap(g => g.items.map(i => i.to))).toEqual(['/users'])

// users.test.ts
expect(toUsersQuery({ page: 2, size: 50, sort: '-createdAt' })).toEqual({ page: 2, limit: 50, sort: '-createdAt' })
expect(usersListSearchSchema.parse({ page: '3', size: 7 })).toEqual({ page: 3, size: 20 }) // a hand-edited URL falls back

// prefs.test.ts
writePrefs(storage, 'u1', { sidebar: 'rail' })
expect(readPrefs(storage, 'u1')).toEqual({ sidebar: 'rail' })
expect(readPrefs(storage, 'u2')).toEqual({ sidebar: 'full' }) // one user's choice is not another's
storage.setItem('edmes.web.prefs.u3', '{not json')
expect(readPrefs(storage, 'u3')).toEqual({ sidebar: 'full' })

// safe-redirect.test.ts
expect(safeRedirect('/users?page=2')).toBe('/users?page=2')
expect(safeRedirect('https://evil.example/')).toBe('/')
expect(safeRedirect('//evil.example/')).toBe('/')
expect(safeRedirect(undefined)).toBe('/')

// resolve-language.test.ts
expect(resolveLanguage({ user: 'tr', stored: 'en', browser: 'en-US' })).toBe('tr')
expect(resolveLanguage({ stored: 'tr', browser: 'de-DE' })).toBe('tr')
expect(resolveLanguage({ browser: 'tr-TR' })).toBe('tr')
expect(resolveLanguage({ browser: 'de-DE' })).toBe('en')
```

```tsx
// users-table.browser.test.tsx
it('shows one row per user', ...) // two users → both e-mail addresses are visible
it('shows the empty state for no rows', ...) // rows [] → the text of 'users.empty'
it('asks for the next page', ...) // click "Next" on page 1 of 3 → onPageChange(2)
it('asks for another page size', ...) // choose 50 → onSizeChange(50)

// page-state.browser.test.tsx
it('shows the reference of a failed load and retries', ...) // traceId 'abc-123' is visible; click "Try again" → onRetry
it('lets a user with no access to the app sign out', ...) // NoPermission with onSignOut → the button calls it

// login-form.browser.test.tsx
it('shows the lockout message of the server', ...) // ApiError code 'auth.account_temporarily_locked' → its message is in role="alert"
// The design's live countdown ("Try again in 4:32") and "2 attempts left" need numbers the API does not
// return: remainingSeconds exists only inside the translated message. They wait for backend change B10.
it('shows the message of the server and lets the user try again', async () => {
  // onSubmit rejects with ApiError { status: 401, message: 'Invalid email or password' }
  await expect.element(screen.getByRole('alert')).toHaveTextContent('Invalid email or password')
  await expect.element(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
})
it('submits once while the request is pending', ...) // two quick clicks → onSubmit called once
```

- [ ] **Step 2: Run** `pnpm --filter web-app test` — Expected: FAIL.
- [ ] **Step 3: Scaffold the app** (`package.json` name `web-app`, scripts `dev: vite`, `build: vite build`, `typecheck: tsc --noEmit`, `test: vitest run`; `vite.config.ts` returns `sharedConfig({ root: import.meta.dirname, base: '/', port: 5173 })`; `app.css` imports `@mes/ui/globals.css` and declares `@source '../../../packages/ui/src'`).
- [ ] **Step 4: Implement** the routes, components, features, data module and i18n. Every string goes through `t()` and exists in both locale files.
- [ ] **Step 5: Run** `pnpm --filter web-app test && pnpm typecheck && pnpm lint` — Expected: PASS.
- [ ] **Step 6: Verify the compiler and the build.** Run `pnpm --filter web-app dev`, then `curl -s http://localhost:5173/src/components/app-sidebar.tsx | grep -c "compiler-runtime"` — Expected: `1` or more. If it prints `0`, put `babel(...)` before `react()` in `sharedConfig` and check again. Then `pnpm --filter web-app build` — Expected: `apps/web/dist/index.html` and `apps/web/dist/version.json` exist. Change one line in `packages/ui/src/components/button.tsx` and run `pnpm build` — Expected: the `web-app` build is a cache miss.
- [ ] **Step 7: Check by hand** with `docker compose up -d` running: sign in as the system admin at `http://localhost:5173`, open Users, change the page, reload (still signed in, same page).
- [ ] **Step 8: Commit**

```bash
git add apps/vite.shared.ts apps/web packages/frontend pnpm-lock.yaml
git commit -m "feat: add the web app shell with sign-in and the users list"
```

---

### Task 9: Operator panel shell and the station screen

**Files:**
- Create: `apps/operator/{package.json,index.html,vite.config.ts,tsconfig.json,vitest.config.ts,components.json}`
- Create: `apps/operator/src/{main.tsx,router.tsx,app.css}`, `src/locales/{en,tr}.ts`, `src/station/station-store.ts`
- Create: `apps/operator/src/routes/{__root.tsx,login.tsx,select-work-center.tsx,_station.tsx,_station/index.tsx}`
- Create: `apps/operator/src/features/station/{work-center-picker.tsx,station-screen.tsx,current-job-order.tsx}`
- Create: `packages/frontend/src/data/work-center/work-centers.ts`, `packages/frontend/src/data/production/job-orders.ts`
- Test: `apps/operator/src/station/station-store.test.ts`, `apps/operator/src/features/station/{work-center-picker,current-job-order}.browser.test.tsx`

**Interfaces:**
- Consumes: everything Task 8 consumes; `reloadWhenIdle` (Task 4); `jobOrderRuntimeState` (Task 4)
- Produces:

```ts
// apps/operator/src/station/station-store.ts — storage key 'edmes.operator.station'
export type ReconcileResult = 'kept' | 'cleared' | 'auto-selected' | 'none'
export interface StationStore {
  getWorkCenterId(): string | null
  select(workCenterId: string): void
  clear(): void
  reconcile(visibleIds: readonly string[]): ReconcileResult
  subscribe(listener: () => void): () => void
}
export function createStationStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): StationStore

// @mes/frontend/data/work-center/work-centers
export function workCentersListOptions(api: ApiClient, query: { status?: 'active' | 'archived' })
// @mes/frontend/data/production/job-orders
export function runningJobOrderOptions(api: ApiClient, workCenterId: string)
// GET /job-orders?workCenterIds=<id>&runtimeState=running&limit=1, selecting the first item or null

// features/station
export function WorkCenterPicker(props: {
  workCenters: readonly { _id: string; code: string; name: string }[]
  onSelect: (workCenterId: string) => void
  onSignOut: () => void
}): ReactNode
export function CurrentJobOrder(props: { jobOrder: JobOrder | null }): ReactNode
```

Rules:
- `index.html` sets `<html data-density="touch">`. `vite.config.ts` uses `base: '/operator/'`, port 5174; the router is created with `basepath: '/operator'`.
- `createAppCore({ app: 'operator', … })` uses `edmes.operator.token`.
- The canvas has no operator panel boards yet. This task builds the panel's structure from the same tokens and primitives in touch density; its screens are restyled when their boards exist.
- `_station` `beforeLoad`: `anonymous` → `/login`. Without `accessOperatorPanel` → a no-access screen **with a sign-out button**. No station → `/select-work-center`.
- Status `unreachable` behaves as in the web app and is checked before the permission: with a user in the session the station keeps rendering under the banner of `common.unreachable`; without a user (the tablet started during an outage) the same message is shown full-screen and `session.bootstrap()` runs every 5 s. It never reaches the `accessOperatorPanel` check with an empty permission list.
- When the session becomes `anonymous` while the panel is open, the login page opens; after signing in, the stored station is reconciled and the operator is back on the station screen.
- `/select-work-center` loads `workCentersListOptions(api, { status: 'active' })` and calls `station.reconcile(ids)`: `kept` or `auto-selected` → navigate to the station.
- The station screen calls `useRealtimeRooms(['wc:' + id])`, shows the work center name, `CurrentJobOrder` and a `ConnectionIndicator`. When `onRoomsDenied` contains the station's room it calls `station.clear()` and navigates to the picker.
- The station's queries are live (the default): nothing in the panel waits for a refresh press.
- Indicator status: the same mapping as the web app's top bar.
- `apps/operator/turbo.json` is the same as `apps/web/turbo.json`.
- `session.logout()` leaves `edmes.operator.station` untouched.
- `main.tsx`: `onMismatch` calls `reloadWhenIdle({ isBusy: () => queryClient.isMutating() > 0 || document.querySelector('[role="dialog"]') !== null, reload: () => location.reload() })`.

- [ ] **Step 1: Write the failing tests**

```ts
// station-store.test.ts
it('keeps a stored station that is still visible', () => {
  store.select('wc1')
  expect(store.reconcile(['wc1', 'wc2'])).toBe('kept')
})
it('clears a stored station that is no longer visible', () => {
  store.select('wc9')
  expect(store.reconcile(['wc1'])).toBe('cleared')
  expect(store.getWorkCenterId()).toBeNull()
})
it('selects the only visible work center', () => {
  expect(store.reconcile(['wc1'])).toBe('auto-selected')
  expect(store.getWorkCenterId()).toBe('wc1')
})
it('selects nothing when several or none are visible', () => {
  expect(store.reconcile(['wc1', 'wc2'])).toBe('none')
  expect(store.reconcile([])).toBe('none')
})
it('survives a sign-out', () => {
  store.select('wc1')
  storage.removeItem('edmes.operator.token')
  expect(createStationStore(storage).getWorkCenterId()).toBe('wc1')
})
```

```tsx
// work-center-picker.browser.test.tsx
it('says so when no work center is assigned and offers sign-out', async () => {
  const screen = await render(<WorkCenterPicker workCenters={[]} onSelect={onSelect} onSignOut={onSignOut} />)
  await expect.element(screen.getByText('No work center is assigned to you')).toBeVisible()
  await screen.getByRole('button', { name: 'Sign out' }).click()
  expect(onSignOut).toHaveBeenCalledOnce()
})
it('offers each work center as a target of at least 48 px', ...) // two work centers → two buttons, height ≥ 48
// current-job-order.browser.test.tsx
it('says so when nothing is running', ...) // jobOrder null → 'No running job order'
it('shows the code and the target of the running job order', ...) // code 'JO-1001', targetQuantity 500
```

- [ ] **Step 2: Run** `pnpm --filter operator-panel test` — Expected: FAIL.
- [ ] **Step 3: Scaffold and implement** (`package.json` name `operator-panel`, same scripts as `web-app`).
- [ ] **Step 4: Run** `pnpm --filter operator-panel test && pnpm typecheck && pnpm lint && pnpm --filter operator-panel build` — Expected: PASS; `apps/operator/dist/index.html` references `/operator/assets/`.
- [ ] **Step 5: Check by hand** with `docker compose up -d` running: sign in at `http://localhost:5174/operator/` as a user with the ready-made Operator role and one work center; the station screen opens and the indicator shows live.
- [ ] **Step 6: Commit**

```bash
git add apps/operator packages/frontend pnpm-lock.yaml
git commit -m "feat: add the operator panel shell with the station screen"
```

---

### Task 10: Image, gateway routing, release and CI

**Files:**
- Create: `apps/Dockerfile`, `apps/nginx.conf`
- Modify: `docker-compose.yml` (new `frontend` service; `/uploads` on the `user` router at L180), `docker-compose.override.yml`, `.github/workflows/release.yml:24-47`, `.github/workflows/ci.yml` (`unit` job installs Chromium), `.github/dependabot.yml`, `install.sh:125`, `docs/operations/installation.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `pnpm --filter web-app build`, `pnpm --filter operator-panel build`, `version.json` (Tasks 8, 9)
- Produces: image `ghcr.io/ulasdnz/edmes-frontend:${EDMES_VERSION:-dev}`, Compose service `frontend`, listening on 8080

Decisions:
- **Dockerfile:** the builder stage uses the same `node` image and digest as `user/Dockerfile`, installs with `pnpm install --frozen-lockfile --filter web-app... --filter operator-panel...`, takes `ARG EDMES_VERSION=dev` and exports it for the builds. The runner is `nginxinc/nginx-unprivileged:<current stable>-alpine@sha256:<index digest>` (read the digest with `docker buildx imagetools inspect`), with `apps/web/dist` at `/usr/share/nginx/html` and `apps/operator/dist` at `/usr/share/nginx/html/operator`.
- **nginx.conf:**
  - `location = /healthz` returns 200.
  - `location ~ ^/(api|internal|socket\.io|docs|uploads)(/|$)` returns 503 with `Content-Type: application/json`, `Cache-Control: no-store` and `{"error":{"code":"gateway.unavailable","message":"Service unavailable"}}`, so an API path never receives the SPA's HTML; a stopped service's router is gone, so its paths land here and clients treat the answer like any 5xx (changed by the final review fix wave; it was 404).
  - `location = /operator` redirects 301 to `/operator/`; `location /operator/` uses `try_files $uri /operator/index.html`; `location /` uses `try_files $uri /index.html`.
  - Files under `assets/` get `Cache-Control: public, max-age=31536000, immutable`. `index.html` and `version.json` get `Cache-Control: no-cache`.
  - Every response carries `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. An `add_header` inside a `location` replaces the server-level ones, so the policy lives in an included file that every `location` with its own `add_header` includes.
- **Compose:** `frontend` follows the `user` service's shape (logging anchor, network, restart, resource limits `cpus: '0.25'`, `memory: 64M`), with healthcheck `wget --spider http://localhost:8080/healthz` and labels: rule ``PathPrefix(`/`)``, `priority=1`, entrypoint `web`, middlewares `global-compress@docker,secure-headers@docker`, port 8080. Append `` || PathPrefix(`/uploads`)`` to the `user` router rule.
- **Release:** add `frontend` to the matrix; the Dockerfile path is `apps/Dockerfile` for `frontend` and `$SERVICE/Dockerfile` otherwise; pass `--build-arg EDMES_VERSION=$version`.
- **CI:** the `unit` job runs `pnpm exec playwright install --with-deps chromium` before `pnpm test`.

- [ ] **Step 1: Write `apps/nginx.conf` and `apps/Dockerfile`**, add the Compose service and the override `build` entry (`context: .`, `dockerfile: apps/Dockerfile`).
- [ ] **Step 2: Run** `docker compose up -d --build --wait` — Expected: every service healthy, including `frontend`. `docker compose build user` still succeeds with the frontend importers in the lockfile.
- [ ] **Step 3: Verify the routing** (each line prints the expected value)

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/                        # 200
curl -s http://localhost/users | grep -c 'id="root"'                              # 1
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost/operator # 301 http://localhost/operator/
curl -s http://localhost/operator/select-work-center | grep -c '/operator/assets/' # 1 or more
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/v1/users/me         # 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/v1/no-such-thing    # 503
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/internal/v1/users       # 503
curl -s http://localhost/version.json                                             # {"version":"dev"}
curl -sI http://localhost/index.html | grep -i cache-control                      # no-cache
curl -sI http://localhost/ | grep -ic content-security-policy                     # 1
curl -sI http://localhost/version.json | grep -ic content-security-policy         # 1
```

- [ ] **Step 4: Update** `release.yml`, `ci.yml`, `dependabot.yml` (a `docker` entry for `/apps`), `install.sh` (print the operator panel URL `http://$host/operator/`), `docs/operations/installation.md` (seven images, both URLs) and `CLAUDE.md` (apps in the architecture section, the dev commands, the image list).
- [ ] **Step 5: Run** `bash scripts/package-release.sh --offline` if it can run locally and confirm `edmes-frontend` is in the bundle's image list; otherwise read the script and confirm it takes its list from the Compose file.
- [ ] **Step 6: Commit**

```bash
git add apps/Dockerfile apps/nginx.conf docker-compose.yml docker-compose.override.yml .github install.sh docs/operations/installation.md CLAUDE.md
git commit -m "feat: serve both frontends from one image behind the gateway"
```

---

### Task 11: UI end-to-end tests against the stack

**Files:**
- Create: `apps/ui-e2e/{package.json,tsconfig.json,playwright.config.ts}`
- Create: `apps/ui-e2e/src/{seed.ts,global-teardown.ts}`
- Create: `apps/ui-e2e/src/{routing,web-auth,web-users-realtime,outage,operator-station,operator-guards}.spec.ts`
- Modify: root `package.json` (`"test:ui-e2e": "docker compose up -d --build --wait && pnpm --filter ui-e2e test"`), `.github/workflows/ci.yml` (job `ui-e2e`), `.gitignore` (`apps/ui-e2e/logs`, `playwright-report`, `test-results`), `CLAUDE.md`

**Interfaces:**
- Consumes: the running Compose stack at `E2E_BASE_URL` (default `http://localhost`); the system admin credentials from the environment
- Produces:

```ts
// apps/ui-e2e/src/seed.ts — everything is created through the public API as the system admin
export interface Seed {
  admin: { email: string; password: string; token: string }
  viewer: { email: string; password: string } // the ready-made Viewer role (found by its key through GET /roles)
  limited: { email: string; password: string } // a role the seed creates with accessWebApp only
  operator: { email: string; password: string } // the ready-made Operator role; workCenterIds [workCenter._id]
  unassignedOperator: { email: string; password: string } // the same role, workCenterIds []
  workCenter: { _id: string; name: string }
}
export function seed(request: APIRequestContext): Promise<Seed>
export function startJobOrder(request: APIRequestContext, seed: Seed): Promise<{ code: string }>
```

`seed` and `startJobOrder` build the same chain `e2e/src/oee.e2e.test.ts` builds (edge device, tag type, tags, work center, unit, product, product standard, job order, start); read that file for the payloads. `playwright.config.ts` sets `trace: 'on'`, one worker, Chromium, and a second project with a 1280×800 touch viewport for the operator specs. `global-teardown.ts` writes `docker compose logs --no-color <service>` for every service into `apps/ui-e2e/logs/`.

- [ ] **Step 1: Write the specs**

```ts
// routing.spec.ts — the curl checks of Task 10 Step 3, as `request` assertions

// web-auth.spec.ts
test('a wrong password stays on the login page with a message', ...)
test('the admin signs in, sees Users, and is still signed in after a reload', ...)
test('a user without readUsers has no Users entry and sees the no-permission state at /users', ...) // seed.limited
test('the ready-made Viewer sees Users and no button that changes anything', ...) // seed.viewer
test('the ready-made Operator cannot enter the web app and can sign out', async ({ page }) => {
  // sign in at / as seed.operator
  await expect(page.getByText('has no access to the web app')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
})
test('an expired session returns to the same view after signing in', async ({ page }) => {
  // signed in on /users?page=2&size=50
  await page.evaluate(() => localStorage.setItem('edmes.web.token', 'garbage'))
  await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 45_000 }) // the heartbeat gets a 401
  // sign in again
  await expect(page).toHaveURL(/\/users\?page=2&size=50/)
  await expect(page.getByRole('table')).toBeVisible()
})
test('a stale token leads to the login page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('edmes.web.token', 'garbage'))
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

// web-users-realtime.spec.ts
test('a user created elsewhere appears without a reload', async ({ page, request }) => {
  // signed in on /users; POST /api/v1/users with the admin token
  await expect(page.getByText(newEmail)).toBeVisible({ timeout: 5000 })
})
test('a burst of new users costs a few list requests, not one each', async ({ page, request }) => {
  const listRequests: string[] = []
  page.on('request', r => { if (r.url().includes('/api/v1/users?')) listRequests.push(r.url()) })
  const startedAt = Date.now()
  // create ten users through the API, one after another
  const burstMs = Date.now() - startedAt
  await expect(page.getByText(lastEmail)).toBeVisible({ timeout: 5000 })
  // the throttle allows one refetch at the first event and one per 2 s window after it
  expect(listRequests.length).toBeLessThanOrEqual(2 + Math.ceil(burstMs / 2000))
})

// outage.spec.ts
test('an outage of user-service does not sign the user out', async ({ page }) => {
  // signed in on /users; `docker compose stop user`
  await expect(page.getByRole('status').filter({ hasText: 'Offline since' })).toBeVisible({ timeout: 60_000 })
  await expect(page).not.toHaveURL(/\/login/)
  // `docker compose start user`
  await expect(page.getByRole('table')).toBeVisible({ timeout: 60_000 })
})

// operator-station.spec.ts
test('the operator lands on the only visible station and sees a job order start live', async ({ page, request }) => {
  await page.goto('/operator/') // sign in as seed.operator
  await expect(page.getByText(seed.workCenter.name)).toBeVisible()
  await expect(page.getByText('No running job order')).toBeVisible()
  const { code } = await startJobOrder(request, seed)
  await expect(page.getByText(code)).toBeVisible({ timeout: 5000 })
})
test('when the token runs out the operator signs in again and is back at the station', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('edmes.operator.token', 'garbage'))
  await expect(page).toHaveURL(/\/operator\/login/, { timeout: 45_000 }) // the heartbeat notices, nobody touched the screen
  // sign in again
  await expect(page.getByText(seed.workCenter.name)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible()
})

// operator-guards.spec.ts
test('an operator with no work center is told so and can sign out', ...) // seed.unassignedOperator
test('the ready-made Viewer cannot enter the panel and can sign out', ...) // seed.viewer holds no accessOperatorPanel
test('signing in to the web app does not replace the session of the panel', ...) // both keys hold different tokens
```

The shell and gateway behaviours the scenario file (`docs/test-scenarios/frontend-foundation.md`) lists under Web.shell, Operator.shell and Gateway.nginx have no unit test file; each of their bullets is a test in the spec file that group names (`web-auth`, `outage`, `operator-station`, `routing`).

- [ ] **Step 2: Run** `pnpm test:ui-e2e` — Expected: every spec PASSES against the stack built from this branch. A failure is a bug in Tasks 1-10; fix it there, not in the spec.
- [ ] **Step 3: Add the CI job `ui-e2e`**, shaped like the existing `e2e` job: install, create `.env` from `.env.example` with generated secrets, `pnpm exec playwright install --with-deps chromium`, `pnpm test:ui-e2e` with a 15-minute step timeout, then upload `apps/ui-e2e/logs/` and `apps/ui-e2e/playwright-report/` with `if: ${{ !cancelled() }}`.
- [ ] **Step 4: Document** `pnpm test:ui-e2e` in `CLAUDE.md` (commands and testing sections).
- [ ] **Step 5: Run** `pnpm lint && pnpm typecheck && pnpm test` — Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/ui-e2e package.json pnpm-lock.yaml .github/workflows/ci.yml .gitignore CLAUDE.md
git commit -m "test: cover both frontends end to end against the stack"
```

---

## After this plan

Each of these is its own plan:

1. The monitoring read API (`docs/superpowers/specs/2026-11-25-monitoring-read-api-design.md`), a backend plan that does not depend on this one.
2. Web app features, one plan per sidebar group of the canvas, each starting with its modules' OpenAPI registration and their rows in `invalidationMap`: System, Master data, Production, Stops, Telemetry, then Monitoring (Live floor and the wall display, Overview, OEE analysis, Timeline, Trends), which reads from all the others and from the read API and brings the charts.
3. Operator panel flows, once the panel has boards: check-in, start and end, scrap and adjustments (after backend change B4), stops, live counters.

When the canvas changes a token, `packages/ui/src/styles/theme.css` changes with it; no plan is needed for that.
