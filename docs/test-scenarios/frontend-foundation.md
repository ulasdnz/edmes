# Test Scenarios: frontend-foundation

> Generated: 2026-11-25 | Spec: docs/superpowers/specs/2026-11-25-dual-frontend-architecture-design.md | Plan: docs/superpowers/plans/2026-11-25-frontend-foundation.md
> Status: READY
> Immutable after implementation starts.
>    To change: update this file, then re-run /write-scenario-tests.

Scope: the foundation plan only (Tasks 1, 1B, 2 to 11). Feature screens, the monitoring read API and the operator flows are not covered.

RESOLVED: The shell, gateway and toolchain behaviours the plan defines without a unit test file are tests in the target each group names: Web.shell, Web.shellOutage, Operator.shell, Operator.shellOutage, Gateway.nginx and Toolchain.contractAndWorkspace (reason: the plan's Task 11 now assigns each of these bullets to the spec file its group names).

---

## UsersMe.permissions
> target: user/src/modules/user/__tests__/user.routes.test.ts
> plan-task: 1

### happy path
- caller holds one role with permissions `['readUsers', 'accessWebApp']`, `GET /api/v1/users/me` with a valid Bearer token → 200, `meta.permissions` sorted equals `['accessWebApp', 'readUsers']`
- same request → `meta.plantTimezone` equals `config.PLANT_TIMEZONE` and `meta.serverTime` is still returned beside `permissions`

### boundaries
- caller with no roles → 200, `meta.permissions` equals `[]`

### authorization
- [CRITICAL] two users with different roles each call `/users/me` → each gets the permissions of their own token, never the other's
- [CRITICAL] a user with one failed sign-in attempt signs in, `POST /api/v1/auth/login` → 200, `data.user` has no `password`, `failedLoginAttempts` or `lastFailedLoginAt`; `GET /users/me` with that token → `data` has neither counter

---

## Privileges.applicationCodes
> target: user/src/modules/user/__tests__/user.routes.test.ts
> plan-task: 1

### constraints
- `VALID_PRIVILEGE_CODES.has('accessWebApp')` → `true`
- `VALID_PRIVILEGE_CODES.has('accessOperatorPanel')` → `true`
- `PRIVILEGES.filter(p => p.code.endsWith('Screen'))` → `[]` (the 15 `access*Screen` codes are gone)
- `APPLICATION_PRIVILEGES` → exactly `accessWebApp` (text `Access Web App`) and `accessOperatorPanel` (text `Access Operator Panel`)
- order of `PRIVILEGES` → the two application privileges come first

---

## DefaultRoles.firstInstall
> target: user/src/core/loaders/default-roles.test.ts
> plan-task: 1B

### happy path
- `ensureDefaultRoles({ firstInstall: true })` with no ready-made role in the database → five roles whose keys sorted are `['operator', 'planner', 'quality', 'shiftSupervisor', 'viewer']`
- the five roles → names `Planner`, `Shift Supervisor`, `Quality`, `Operator`, `Viewer`
- each created role → `defaultPermissions` equals its `permissions`
- `planner` → exactly `accessWebApp`, every `read*` code, `writeProductionPlans`, `deleteProductionPlans`, `writeJobOrders`, `deleteJobOrders`, `writeSchedules`, `writeProductStandards`, `deleteProductStandards`
- `shiftSupervisor` → exactly `accessWebApp`, `accessOperatorPanel`, every `read*` code, `executeJobOrders`, `writeOperators`, `writeProductionAdjustments`, `createUnplannedStops`, `writeUnplannedStops`, `executeUnplannedStops`, `createPlannedStops`, `writePlannedStops`, `executePlannedStops`, `executePlannedStopTemplates`
- `quality` → exactly `accessWebApp`, every `read*` code, `writeProductionAdjustments`, `deleteProductionAdjustments`, `createReasons`, `writeReasons`
- `operator` → exactly `accessOperatorPanel`, `readWorkCenters`, `readSchedules`, `readOperators`, `writeOperators`, `readCatalog`, `readProductStandards`, `readJobOrders`, `executeJobOrders`, `readProductionAdjustments`, `writeProductionAdjustments`, `readReasons`, `readPlannedStops`, `executePlannedStops`, `readPlannedStopTemplates`, `executePlannedStopTemplates`, `readUnplannedStops`, `createUnplannedStops`, `writeUnplannedStops`, `executeUnplannedStops`, `readTags`, `readHistorian`, `readOee`
- `viewer` → permissions sorted equal `['accessWebApp', ...every code in PRIVILEGES that starts with 'read']` sorted
- creating a ready-made role → emits `role.created`, through the same path as `ensureSystemAdminRole`

### constraints
- `getInvalidPrivilegeCodes(DEFAULT_ROLES.flatMap(r => [...r.permissions]))` → `[]`
- `READ` is computed from `PRIVILEGES` → every code that starts with `read` is in `planner`, `shiftSupervisor`, `quality` and `viewer`
- `firstInstall: true` and a role with one of the five keys already exists → only the missing roles are created, no duplicate key
- a second role saved with an existing `key` → rejected (unique index)
- several roles without `key` (customer roles) → all allowed (sparse index)

### authorization
- [CRITICAL] `operator` → holds `accessOperatorPanel` and `readJobOrders`, does not hold `accessWebApp`
- [CRITICAL] `viewer` → holds nothing that changes data: only `accessWebApp` and `read*` codes
- [CRITICAL] `shiftSupervisor` is the only ready-made role with both `accessWebApp` and `accessOperatorPanel`; `planner`, `quality` and `viewer` do not hold `accessOperatorPanel`

---

## DefaultRoles.laterRuns
> target: user/src/core/loaders/default-roles.test.ts
> plan-task: 1B

### happy path
- stored `viewer` lacks `readOee` in both `permissions` and `defaultPermissions`, `ensureDefaultRoles({ firstInstall: false })` → `permissions` contains `readOee`
- after that run → `defaultPermissions` equals the current definition
- a code added to an existing ready-made role → emits `role.updated`

### constraints
- `firstInstall: false` and no ready-made role in the database → none is created
- a ready-made role is found by `key` → a renamed role still receives a code that is new in its definition

### edge cases
- [HIGH] `quality` deleted by the customer, `firstInstall: false` → `Role.exists({ key: 'quality' })` is `null` (never recreated)
- [HIGH] `planner` renamed to `Planlamacı` and `deleteJobOrders` pulled, `firstInstall: false` → name stays `Planlamacı`, `permissions` still without `deleteJobOrders`
- [HIGH] `readOee` added by one run, then pulled by the customer, next run → `permissions` still without `readOee` (a new privilege is added exactly once)
- [HIGH] customer added an extra code to a ready-made role → the code is still there after the run (nothing is ever removed from `permissions`)

---

## DefaultRoles.loaderOrder
> target: user/src/core/loaders/__tests__/system-admin.test.ts
> plan-task: 1B

### happy path
- empty database, bootstrap enabled, `initLoaders()` → the five ready-made roles and the system admin role exist

### constraints
- bootstrap enabled, the system admin role exists and no ready-made role does, `initLoaders()` → no ready-made role is created (first install means bootstrap enabled and no system admin role yet, decided before the system admin role is created)
- `SYSTEM_ADMIN_BOOTSTRAP_ENABLED=false`, empty database, `initLoaders()` → no ready-made role and no system admin role is created

### edge cases
- [HIGH] a first start stopped after some ready-made roles and before the system admin role (`quality`, `operator`, `viewer` missing, no system admin role), `initLoaders()` → five ready-made roles and the system admin role exist
- [HIGH] after a completed first start, `quality` deleted, `initLoaders()` → `Role.exists({ key: 'quality' })` is `null`

RESOLVED: The system admin role is the marker that a first install finished, so a crash between the ready-made roles and the system admin role is finished by the next start (reason: ledger Task 1B ruling on finding 1).

---

## OpenApiDocument.userService
> target: user/src/lib/openapi/document.test.ts
> plan-task: 2

### constraints
- every `METHOD /path` mounted on `userRoutes`, `authRoutes`, `roleRoutes` and `specialityRoutes` (with `:id` rewritten to `{id}`) → present in `openApiDocument.paths`; the list of undocumented routes is `[]`
- the `/users/me` response schema in the document → has `meta` with `permissions`
- the `POST /auth/login` 200 response's `user` schema in the document → has no `failedLoginAttempts` and no `lastFailedLoginAt`

---

## OpenApiDocument.workCenterService
> target: work-center/src/lib/openapi/document.test.ts
> plan-task: 2

### happy path
- `Object.keys(openApiDocument.paths)` → contains `/work-centers` and `/work-centers/{id}`

---

## OpenApiDocument.productionService
> target: production/src/lib/openapi/document.test.ts
> plan-task: 2

### happy path
- `openApiDocument.paths['/job-orders'].get.parameters` → names contain `workCenterIds`, `runtimeState`, `page`, `limit`
- `openApiDocument.paths` → contains `/job-orders/{id}` with a `get`

---

## ApiClient.request
> target: packages/api-client/src/client.test.ts
> plan-task: 3

### happy path
- `getToken` returns `'tkn'`, `getLocale` returns `'tr'` → the request carries `Authorization: Bearer tkn` and `Accept-Language: tr`

### constraints
- `getToken` returns `null` → no `Authorization` header is sent
- 400 with `{ error: { code: 'error.validation_failed', message: 'Validation failed', details: [{ field: 'email', message: 'Invalid email' }] } }` → rejects with `ApiError { kind: 'http', status: 400, code: 'error.validation_failed', message: 'Validation failed', details: [{ field: 'email', message: 'Invalid email' }] }`
- error response with header `X-Trace-Id: abc-123` → `error.traceId === 'abc-123'`

### edge cases
- [HIGH] connection refused → rejects with `kind: 'network'`, `code: 'client.network'`, `status: 0`
- [HIGH] server answers after 200 ms, `timeoutMs: 50` → rejects with `kind: 'timeout'`, `code: 'client.timeout'`, `status: 0`
- [HIGH] 502 with body `Bad Gateway` and `content-type: text/plain` → rejects with `status: 502`, `code: 'client.unexpected_response'` (no parse crash)
- [HIGH] 503 `auth.unavailable` → rejects with `status: 503`, `code: 'auth.unavailable'`; `onUnauthorized` is not called
- [HIGH] 503 with `content-type: application/json` and body `{"error":{"code":"gateway.unavailable","message":"Service unavailable"}}` (the frontend nginx's answer for a stopped service) → rejects with `kind: 'http'`, `status: 503`, `code: 'gateway.unavailable'`, `message: 'Service unavailable'`; `onUnauthorized` is not called
- [HIGH] the caller aborts the request through its `signal` → rejects with the original abort error (`name: 'AbortError'`), not an `ApiError`
- `isAbortError` → `true` for a caller's abort error, `false` for a timeout and for a refused connection
- `toApiError(new DOMException('aborted', 'AbortError'))` → `ApiError { kind: 'aborted', status: 0, code: 'client.aborted' }`, no throw
- `toApiError` of `'boom'`, `undefined`, `null` or `42` → an `ApiError`, no throw (it never throws)

### authorization
- [CRITICAL] 401 with code `auth.unauthenticated`, on any path → `onUnauthorized` is called exactly once and the call rejects with `status: 401`
- [CRITICAL] 401 with another code from `/auth/login` (a wrong password) → `onUnauthorized` is not called; the call rejects with that request's `ApiError`
- [CRITICAL] 401 with another code on any other path → `onUnauthorized` is not called; it is only the error of that request
- [CRITICAL] a request sent with token `old`, the current token is `new` when it answers 401 `auth.unauthenticated` → `onUnauthorized` is not called (a late answer never ends a newer session)
- [CRITICAL] a request sent without a token answers 401 `auth.unauthenticated` → `onUnauthorized` is not called
- [HIGH] two requests with the same token both answer 401 `auth.unauthenticated`, `onUnauthorized` clears the token → `onUnauthorized` is called once

RESOLVED: `ApiErrorKind` is `'http' | 'network' | 'timeout' | 'aborted'`, `toApiError` never throws, `isAbortError` is exported, and `onUnauthorized` fires only for a 401 `auth.unauthenticated` whose request carried a token that is still the current one (reason: ledger Task 3 rulings and its completion contract).

RESOLVED: Only a response with status 401 and code `auth.unauthenticated` ends a session, on any path; a 401 with another code (a wrong password at `/auth/login`) is only that request's error (reason: Global Constraints and spec §6.4 name the code, and Task 5 Step 3 now says the same).

---

## JobOrder.runtimeState
> target: packages/frontend/src/domain/job-order.test.ts
> plan-task: 4

### happy path
- `{}` → `'pending'`
- `{ startTime: '2026-04-04T12:30:00.000Z' }` → `'running'`
- `{ startTime: '2026-04-04T12:30:00.000Z', endTime: '2026-04-04T13:00:00.000Z' }` → `'finished'`

### boundaries
- `{ startTime: null, endTime: null }` → `'pending'`

---

## Quantity.good
> target: packages/frontend/src/domain/quantity.test.ts
> plan-task: 4

### happy path
- `goodQuantity({ gross: 1000, scrap: 40, adjustments: -10 })` → `950` (gross − scrap + adjustments)

---

## Time.format
> target: packages/frontend/src/time/format.test.ts
> plan-task: 4

### happy path
- `formatInstant('2026-04-04T12:30:00.000Z', { timeZone: 'Europe/Istanbul', locale: 'tr', style: 'time' })` → `'15:30'` (the plant timezone, not the browser's)
- `plantLocalToInstant('2026-04-04T15:30', 'Europe/Istanbul')` → `'2026-04-04T12:30:00.000Z'`

### constraints
- `isUtcInstant('2026-04-04T12:30:00.000Z')` → `true`
- `isUtcInstant('2026-04-04T12:30:00')` → `false` (no offset)

### edge cases
- [HIGH] local time that does not exist, `plantLocalToInstant('2026-03-29T02:30', 'Europe/Berlin')` → `'2026-03-29T01:30:00.000Z'` (resolves forward)
- [HIGH] local time that happens twice, `plantLocalToInstant('2026-10-25T02:30', 'Europe/Berlin')` → `'2026-10-25T00:30:00.000Z'` (the first one)

---

## Time.serverClock
> target: packages/frontend/src/time/server-clock.test.ts
> plan-task: 4

### edge cases
- [HIGH] device clock `2026-04-04T11:58:00.000Z` (two minutes behind), `createServerClock('2026-04-04T12:00:00.000Z')`, 1000 ms pass → `clock.toIso()` is `'2026-04-04T12:00:01.000Z'`
- [HIGH] device clock `2026-04-04T11:58:00.000Z`, `createServerClock('2026-04-04T12:00:00.000Z')`, `clock.fromDevice(new Date('2026-04-04T11:59:30.000Z'))` → `'2026-04-04T12:01:30.000Z'` (a moment the device recorded, moved onto the server's clock)

---

## Version.check
> target: packages/frontend/src/version/version-check.test.ts
> plan-task: 4

### happy path
- `/version.json` answers `{ version: '1.1.0' }`, `currentVersion: '1.0.0'`, one check → `onMismatch('1.1.0')` is called
- the server version equals `currentVersion` → `onMismatch` is not called

### boundaries
- three checks in a row all see `1.1.0` → `onMismatch` is called once in total (the second and third checks do not call it again)
- a later check sees `1.2.0` → `onMismatch` is called once more, with `'1.2.0'`

### constraints
- no `intervalMs` given → `url` is polled every 300000 ms

### edge cases
- [HIGH] the port is closed → `onMismatch` is not called and `checkNow()` does not reject
- [HIGH] the server answers 502 `text/html` → `onMismatch` is not called and `checkNow()` does not reject

RESOLVED: `startVersionCheck` calls `onMismatch` once in total for the same server version, however many checks see it; a newer different version reports once more (reason: a toast or a reload request repeated every five minutes helps nobody).

---

## Version.chunkReloadGuard
> target: packages/frontend/src/version/chunk-reload-guard.test.ts
> plan-task: 4

### edge cases
- [HIGH] `vite:preloadError` dispatched twice on the target → `reload` is called exactly once
- [HIGH] a second guard of the same version created over the same storage (the page after the reload), then `vite:preloadError` → `reload` is not called again and the event's default is not prevented
- [HIGH] a guard of a later version over the same storage (a second upgrade in the same tab session), then `vite:preloadError` → `reload` is called once and the default is prevented; a third guard of that later version → no reload
- [HIGH] storage that throws → no reload, the default is not prevented

RESOLVED: The chunk reload guard's mark is the build's version: one reload per version, never a loop for the same version. `preventDefault()` runs only when a reload follows, since Vite's preload helper otherwise resolves the import to `undefined` (final review fix wave; it was one reload per tab session).

---

## Version.reloadWhenIdle
> target: packages/frontend/src/version/reload-when-idle.test.ts
> plan-task: 4

### edge cases
- [HIGH] `isBusy` returns `true` for two polls, then `false` → `reload` is called once, and only after the app stops being busy

---

## SessionStore.bootstrap
> target: packages/frontend/src/session/session-store.test.ts
> plan-task: 5

### state transitions
- a new store before `bootstrap()` → status `unknown`
- no stored token, `bootstrap()` → status `anonymous` and no request is made
- stored token, `/users/me` answers 200 with `meta { plantTimezone: 'Europe/Istanbul', serverTime, permissions: ['readUsers'] }` → `{ status: 'authenticated', plantTimezone: 'Europe/Istanbul', permissions: ['readUsers'] }`, `serverClock` built from `serverTime`
- [HIGH] `/users/me` answers 503, the next `bootstrap()` answers 200 → `unreachable`, then `authenticated`

### edge cases
- [HIGH] stored token `'tkn'`, `/users/me` answers 503 `auth.unavailable` → status `unreachable`, `storage.getItem('edmes.web.token')` is still `'tkn'`
- [HIGH] stored token, the server cannot be reached (closed port) → status `unreachable`, token kept
- [HIGH] stored token, `/users/me` answers 401 with a code other than `auth.unauthenticated` → status `unreachable`, token kept (any other failure leaves the token as it was)
- [HIGH] the stored token is replaced with another user's token while `bootstrap()` waits for its answer, then the first answer arrives → that answer is discarded and the status settles as the new token's `authenticated` with the new user, never `unknown`
- [HIGH] the stored token is removed while `bootstrap()` waits for its answer, then the answer arrives → the status settles as `anonymous`, never `unknown`

### authorization
- [CRITICAL] stored token, `/users/me` answers 401 `auth.unauthenticated` → status `anonymous`, `storage.getItem('edmes.web.token')` is `null`
- [CRITICAL] authenticated, another tab removes the stored token, `bootstrap()` → `{ status: 'anonymous', user: null, permissions: [] }`
- [CRITICAL] authenticated as one user, another tab stores another user's token, `bootstrap()` → subscribers see `unknown` with no user first, then `authenticated` with the new user's identity and permissions

---

## SessionStore.login
> target: packages/frontend/src/session/session-store.test.ts
> plan-task: 5

### happy path
- valid e-mail and password → the token of the response is stored under `storageKey` and the status is `authenticated`
- the stored value is replaced directly in storage → the next `getToken()` returns the new value (no in-memory copy)

### constraints
- wrong password (a 401 with a code other than `auth.unauthenticated`) → `login` rejects with an `ApiError`, nothing is stored, status stays `anonymous`
- locked account (429) → `login` rejects with `ApiError` code `auth.account_temporarily_locked`

### edge cases
- [HIGH] login succeeds, the following `/users/me` answers 503 → `login` resolves, status `unreachable`, the token is kept; the next `refresh()` answering 200 → `authenticated`

### authorization
- [CRITICAL] `storageKey: 'edmes.operator.token'`, login → `storage.getItem('edmes.operator.token')` is `'tkn'` and `storage.getItem('edmes.web.token')` is `null`

---

## SessionStore.refreshAndLogout
> target: packages/frontend/src/session/session-store.test.ts
> plan-task: 5

### happy path
- authenticated, `/users/me` now returns other permissions, `refresh()` → the state holds the new permissions
- every successful `refresh()` → `serverClock` is replaced by one built from that answer's `meta.serverTime`
- `logout()` → status `anonymous`; user, permissions and token dropped

### edge cases
- [HIGH] authenticated with `['readUsers']`, `refresh()` gets 503 → status `unreachable`, permissions still `['readUsers']`, `user` not `null`, token kept
- [HIGH] authenticated, `refresh()` gets a 404 HTML page from the gateway → status `unreachable`, user, permissions and token kept
- [HIGH] authenticated, `refresh()` gets no answer at all → status `unreachable`, user, permissions and token kept
- [HIGH] `unreachable` after a failed refresh, the next `refresh()` answers 200 → status `authenticated`

### authorization
- [CRITICAL] authenticated, a later request answers 401 `auth.unauthenticated` (the client calls `logout`) → `{ status: 'anonymous', user: null, permissions: [] }`, `storage.getItem('edmes.web.token')` is `null`
- [CRITICAL] authenticated, `refresh()` answers 401 `auth.unauthenticated` (the heartbeat path) → status `anonymous`, token removed
- [CRITICAL] authenticated, a later request answers 401 with another code → status stays `authenticated`; user, permissions and token kept
- [CRITICAL] authenticated, another tab removes the stored token, `refresh()` (the heartbeat) → `{ status: 'anonymous', user: null, permissions: [] }` and no request is made
- [HIGH] authenticated as one user, another tab stores another user's token, `refresh()` answers 503 → `{ status: 'unreachable', user: null, permissions: [] }` (the first identity is never kept); the next `refresh()` does not go back to `unknown`

---

## SessionStore.can
> target: packages/frontend/src/session/session-store.test.ts
> plan-task: 5

### authorization
- [CRITICAL] permissions `['readUsers']` → `can('readUsers')` is `true`
- [CRITICAL] permissions `['readUsers']` → `can('writeUsers')` is `false`
- [CRITICAL] permissions `['*']` → `can` is `true` for any code
- `store.can('accessUserScreen')` (a misspelled code) → does not compile (`@ts-expect-error`)

---

## RealtimeClient.rooms
> target: packages/frontend/src/realtime/realtime-client.test.ts
> plan-task: 6

### happy path
- `subscribe(['wc:a'])` then `subscribe(['wc:b', 'job_order'])` → the last `join` carries rooms that sorted equal `['job_order', 'wc:a', 'wc:b']`
- the only subscriber of a room unsubscribes → the next `join` carries the union without that room

### constraints
- a room with two subscribers, one unsubscribes → the room stays in the `join`; the last one unsubscribes → it is gone
- several `subscribe` / unsubscribe calls in one microtask → one `join { rooms }` with the full union
- the socket connects with `transports: ['websocket']` → it connects to a server that allows WebSocket only
- the gateway acks `{ rooms: ['job_order'] }` for `['job_order', 'wc:x']` → `onRoomsDenied(['wc:x'])`

### edge cases
- [HIGH] the connection drops and returns → a second `join` with the same rooms is emitted (every `connect` joins again)

### authorization
- [CRITICAL] the token changes between two connections → each handshake carries the current `getToken()` value in `auth.token`

---

## RealtimeClient.invalidation
> target: packages/frontend/src/realtime/realtime-client.test.ts
> plan-task: 6

### happy path
- `invalidationMap` → `user: ['/users']`, `role: ['/roles', '/users']`, `speciality: ['/specialities', '/users']`, `work_center: ['/work-centers']`, `job_order: ['/job-orders']`
- `pathsForEvent('work_center.shift.started', map)` → `map.work_center` (the entity is the text before the first dot)
- active queries `['get', '/job-orders', {}]`, `['get', '/job-orders/{id}', { params: { path: { id: 'j1' } } }]` and `['get', '/users', {}]`, event `job_order.started` → the two job order queries are invalidated, the users query is not
- `on(eventType, handler)` → the handler receives the event payload; the returned function removes it

### constraints
- an event whose entity has no row in the map → no query is invalidated
- a query whose `queryKey[0]` is not `'get'` → not matched
- a query whose `queryKey[1]` neither equals a mapped path nor starts with `<path>/` → not matched
- `eventWorkCenterIds(payload)` → the ids of `workCenterId`, `previousWorkCenterId` and `workCenterIds[]`; `[]` when the payload names none
- `queryWorkCenterIds(queryKey)` → the ids of `path.workCenterId`, `query.workCenterId` and `query.workCenterIds` (comma list); `null` when the query is not about specific work centers
- observed queries `workCenterIds: 'wc1'`, `workCenterIds: 'wc2,wc3'` and `page: 1` (no scope), event `job_order.started { jobOrderId: 'j1', workCenterId: 'wc2' }` → queryFn calls `{ keyWc1: 1, keyWc23: 2, keyAll: 2 }`
- an event that names no work center → every matched query refetches, whatever its work-center scope
- an observed query with `meta: { realtime: false }`, ten matching events → its queryFn was called once (the first load)
- a cached query nobody observes, one matching event → its queryFn count is unchanged and `isInvalidated` is `true`

### boundaries
- `throttleMs: 200`, `user.updated` emitted ten times within 50 ms → the users queryFn is called 3 times (first load, leading refetch, trailing refetch) and still 3 times 400 ms later
- two different matched queries, one event → each gets its own leading refetch (the throttle is per `queryHash`)

### edge cases
- [HIGH] `job_order.updated { workCenterId: 'wc1', previousWorkCenterId: 'wc2' }` → both the `wc1` query and the `wc2,wc3` query refetch
- [HIGH] a matched query's event refetch is still running when more matching events arrive → the running fetch is not aborted (invalidation uses `cancelRefetch: false`), and the query is fetched once more after it settles

---

## RealtimeClient.connection
> target: packages/frontend/src/realtime/realtime-client.test.ts
> plan-task: 6

### state transitions
- `start()` against a reachable gateway → status goes `idle` → `connecting` → `live`
- `live`, the connection drops → status `reconnecting`, and `getStatusSince()` moves to the time that status began

### boundaries
- a `connect` that succeeds on the very first attempt after `start()` → no query is invalidated

### edge cases
- [HIGH] a `connect` that is not the first → every observed query is fetched once more, the `realtime: false` one included, without the throttle
- [HIGH] the first attempt after `start()` is refused (`auth.unavailable`) and a later attempt connects → every observed query is fetched once more, the `realtime: false` one included
- [HIGH] the server disconnects the socket (`serverSocket.disconnect(true)`, reason `io server disconnect`) → the client connects again
- [HIGH] the middleware rejects twice with `auth.unavailable`, then accepts → `onUnauthenticated` is never called and the statuses contain `unavailable` and `live`
- [HIGH] `connect_error` `auth.unavailable` → a new connection attempt after `retryDelayMs`
- status `unavailable` with `retryDelayMs: 60000`, `retryNow()` → connects at once

### authorization
- [CRITICAL] `connect_error` `auth.unauthenticated` → `onUnauthenticated` is called once and no connection attempt follows within 3 × `retryDelayMs`

RESOLVED: Every connect refetches the queries on screen except a clean first connect after `start()`, since the gateway has no replay and a late first connect misses events as a reconnect does (reason: ledger Task 6 ruling on finding 2).

---

## AppCore.sessionAndRealtime
> target: packages/frontend/src/core/create-app-core.test.ts
> plan-task: 6

### happy path
- the session becomes `authenticated` → the realtime client is started
- `role.updated { roleId }` where `roleId` is a role the signed-in user holds → a second `GET /users/me`
- any other `role.*` event whose `roleId` is one of the signed-in user's roles → `session.refresh()` is called
- `user.updated` whose `userId` is the signed-in user → `session.refresh()` is called
- query defaults → `staleTime` is `30000`

### constraints
- `role.updated { roleId }` where `roleId` is a role the signed-in user does not hold → no `GET /users/me`
- `user.updated` for another user → no `GET /users/me`
- status `anonymous` → no heartbeat request is made
- a query fails with `kind: 'http'` (for example 500) → it is not retried
- a query fails with `kind: 'network'` or `'timeout'` → it is retried twice
- a query fails with `kind: 'aborted'` → it is not retried (only `network` and `timeout` are)
- `createAppCore({ onRoomsDenied })`, the gateway acks `{ rooms: ['job_order'] }` for `['job_order', 'wc:x']` → `onRoomsDenied(['wc:x'])`
- a `storage` event for another key, or for another storage area → ignored: no `GET /users/me`, status stays `authenticated`

### edge cases
- [HIGH] `heartbeatMs: 50`, `/users/me` answers 200, then 503 twice, then 200 → statuses `['authenticated', 'unreachable', 'authenticated']`
- [HIGH] the heartbeat gets a 401 `auth.unauthenticated` (the token ran out on an idle screen) → status `anonymous`
- [HIGH] a `POST` mutation answers 500 → it is requested exactly once (mutations are never retried)

### authorization
- [CRITICAL] `app: 'web'` → the token is kept under `edmes.web.token`; `app: 'operator'` → under `edmes.operator.token`
- [CRITICAL] the session ends (`logout()` or a 401 `auth.unauthenticated`) → `queryClient` is cleared and the realtime client is stopped; no cached data of the previous user is left
- [CRITICAL] the realtime client reports `auth.unauthenticated` → `session.logout()` runs and the status is `anonymous`
- [CRITICAL] another tab removes `edmes.web.token` (a `storage` event for that key, or one with key `null` after the storage is cleared) → status `anonymous`, `queryClient` is cleared, the realtime client is `idle`, and no `GET /users/me` is made
- [CRITICAL] another tab stores another user's token (a `storage` event for `edmes.web.token`) → no data read with the first user's token is left in `queryClient`; the session holds the new user's identity and permissions, and the socket connects again with the new token and rejoins `role` and `user`
- [HIGH] the token disappears without a `storage` event, `heartbeatMs: 50` → at the next heartbeat the status is `anonymous`, `queryClient` is cleared, the realtime client is `idle`, and no further `GET /users/me` follows

RESOLVED: A `role.*` event whose `roleId` is one of the signed-in user's roles refreshes the session; an event about another role does not (reason: spec §7 limits the refresh to events that concern the signed-in user, widened from `role.updated` to every role event).

---

## Ui.Button
> target: packages/ui/src/components/button.browser.test.tsx
> plan-task: 7

### happy path
- `<Button>Save</Button>` → 36 px tall
- `<html data-density="touch">` → the same button is 56 px tall

### boundaries
- size `sm` → 28 px tall
- size `sm` under `data-density="touch"` → 48 px tall

### constraints
- `pending` → the button is disabled, has `aria-busy="true"` and shows a spinner
- `pending`, forced click → `onClick` is not called

---

## Ui.ConnectionIndicator
> target: packages/ui/src/components/connection-indicator.browser.test.tsx
> plan-task: 7

### happy path
- `status='offline'`, `label='Offline since 10:31'` → an element with `role="status"` whose text is `Offline since 10:31`

---

## Ui.StatePill
> target: packages/ui/src/components/state-pill.browser.test.tsx
> plan-task: 7

### constraints
- states `running`, `unplanned`, `planned`, `idle` → `data-shape` values `['play', 'octagon', 'pause', 'ring']` (color is never the only signal)

---

## Web.navigation
> target: apps/web/src/navigation.test.ts
> plan-task: 8

### authorization
- [CRITICAL] `visibleNavigation(() => false)` → `[]` (a group with no visible item is dropped)
- [CRITICAL] `visibleNavigation(code => code === 'readUsers')` → item paths `['/users']`

---

## Web.usersListSearch
> target: packages/frontend/src/data/user/users.test.ts
> plan-task: 8

### happy path
- `toUsersQuery({ page: 2, size: 50, sort: '-createdAt' })` → `{ page: 2, limit: 50, sort: '-createdAt' }`

### boundaries
- `usersListSearchSchema.parse({ page: '3', size: 7 })` → `{ page: 3, size: 20 }` (a hand-edited URL falls back)
- `page: 0` or a non-numeric `page` → `page: 1`
- `size` of `20`, `50` or `100` → kept; any other value → `20`
- `search` of 100 characters → accepted; 101 characters → dropped (`{ page: 1, size: 20 }`), `parse` does not throw
- `sort` that is not a string (`{ sort: 5 }`) → dropped (`{ page: 1, size: 20 }`), `parse` does not throw

RESOLVED: Every key of the users list search falls back on a hand-edited URL instead of failing the route (reason: ledger Task 8 ruling; the spec says a hand-edited URL falls back).

---

## Web.prefs
> target: apps/web/src/prefs.test.ts
> plan-task: 8

### happy path
- `writePrefs(storage, 'u1', { sidebar: 'rail' })` then `readPrefs(storage, 'u1')` → `{ sidebar: 'rail' }`, stored under `edmes.web.prefs.u1`

### constraints
- `readPrefs(storage, 'u2')` with nothing stored for `u2` → `{ sidebar: 'full' }` (one user's choice is not another's)

### edge cases
- [HIGH] `edmes.web.prefs.u3` holds `{not json` → `readPrefs(storage, 'u3')` is `{ sidebar: 'full' }`, no throw

---

## Web.safeRedirect
> target: apps/web/src/safe-redirect.test.ts
> plan-task: 8

### happy path
- `safeRedirect('/users?page=2')` → `'/users?page=2'`

### boundaries
- `safeRedirect(undefined)` → `'/'`

### authorization
- [CRITICAL] `safeRedirect('https://evil.example/')` → `'/'`
- [CRITICAL] `safeRedirect('//evil.example/')` → `'/'`

---

## I18n.resolveLanguage
> target: packages/frontend/src/i18n/resolve-language.test.ts
> plan-task: 8

### happy path
- `{ user: 'tr', stored: 'en', browser: 'en-US' }` → `'tr'` (the user's language wins)
- `{ stored: 'tr', browser: 'de-DE' }` → `'tr'`
- `{ browser: 'tr-TR' }` → `'tr'`

### boundaries
- `{ browser: 'de-DE' }` → `'en'` (an unsupported language falls back to English)

---

## Web.UsersTable
> target: apps/web/src/features/users/users-table.browser.test.tsx
> plan-task: 8

### happy path
- two users in `rows` → both e-mail addresses are visible
- click "Next" on page 1 of 3 → `onPageChange(2)`
- choose page size 50 → `onSizeChange(50)`

### boundaries
- `rows: []` → the text of `users.empty` is shown

---

## Web.PageState
> target: apps/web/src/components/page-state.browser.test.tsx
> plan-task: 8

### happy path
- `PageError` with `traceId: 'abc-123'` → the reference `abc-123` is visible; click "Try again" → `onRetry` is called
- `NoPermission` with `onSignOut` → the sign-out button calls it

### edge cases
- [HIGH] `apiErrorMessage` of `ApiError { kind: 'http', status: 503, code: 'gateway.unavailable' }` → the translated `common.serviceUnavailable` text in every locale (`en`: `The service is unavailable. Try again in a moment.`), never the raw code

---

## Web.LoginForm
> target: apps/web/src/features/auth/login-form.browser.test.tsx
> plan-task: 8

### constraints
- `onSubmit` rejects with `ApiError { status: 401, message: 'Invalid email or password' }` → `role="alert"` shows `Invalid email or password` and the "Sign in" button is enabled again
- `onSubmit` rejects with `ApiError` code `auth.account_temporarily_locked` → its message is shown in `role="alert"`

### edge cases
- [HIGH] two quick clicks while the request is pending → `onSubmit` is called once
- [HIGH] `onSubmit` rejects with `ApiError { status: 503, code: 'gateway.unavailable' }` (user-service stopped) → `role="alert"` shows `The service is unavailable. Try again in a moment.`

---

## Operator.LoginForm
> target: apps/operator/src/features/auth/login-form.browser.test.tsx
> plan-task: 9

### edge cases
- [HIGH] `onSubmit` rejects with `ApiError { status: 503, code: 'gateway.unavailable' }` (user-service stopped) → `role="alert"` shows `The service is unavailable. Try again in a moment.`

---

## Operator.stationStore
> target: apps/operator/src/station/station-store.test.ts
> plan-task: 9

### happy path
- `select('wc1')`, `reconcile(['wc1', 'wc2'])` → `'kept'`
- nothing stored, `reconcile(['wc1'])` → `'auto-selected'` and `getWorkCenterId()` is `'wc1'`
- `select('wc1')` → a new store over the same storage returns `'wc1'` (kept under `edmes.operator.station`)

### boundaries
- nothing stored, `reconcile(['wc1', 'wc2'])` → `'none'`
- nothing stored, `reconcile([])` → `'none'`

### edge cases
- [HIGH] `select('wc9')`, `reconcile(['wc1'])` → `'cleared'` and `getWorkCenterId()` is `null` (a station that is no longer visible is dropped)
- [HIGH] `select('wc1')`, then `edmes.operator.token` is removed (sign-out) → a new store still returns `'wc1'`

---

## Operator.WorkCenterPicker
> target: apps/operator/src/features/station/work-center-picker.browser.test.tsx
> plan-task: 9

### happy path
- two work centers → two buttons, each at least 48 px tall

### edge cases
- [HIGH] `workCenters: []` → the text `No work center is assigned to you` is visible (no spinner) and the "Sign out" button calls `onSignOut` once

---

## Operator.CurrentJobOrder
> target: apps/operator/src/features/station/current-job-order.browser.test.tsx
> plan-task: 9

### happy path
- job order with `code: 'JO-1001'` and `targetQuantity: 500` → the code and the target are shown

### boundaries
- `jobOrder: null` → the text `No running job order`

---

## Operator.stationQueries
> target: apps/operator/src/station/station-queries.test.ts
> plan-task: 9

### edge cases
- [HIGH] the observed work-center list answers 503, then 200 → the query succeeds by itself without a person or an event (asked again every 5 s while it is in error and observed)
- [HIGH] the observed running-job-order query answers 502, then 200 → the query succeeds by itself
- [HIGH] `GET /work-centers` or `GET /job-orders` answers the gateway's `503 {"error":{"code":"gateway.unavailable",...}}` twice, then 200 → the query succeeds by itself after 3 requests; meanwhile the screen state is `unavailable`
- a query answers 403 → it is not asked again (only `network`, `timeout` and HTTP >= 500 are retried)
- nothing observes the failing query any more → it stops asking

RESOLVED: The core's quick retry stays (twice, `network` or `timeout` only); the operator panel adds a retry every 5 s while a query is in error and on screen, for `network`, `timeout` and HTTP >= 500, the gateway's JSON 503 included, because nobody watches a tablet (reason: ledger Task 9 ruling on finding 1 and final review fix F1).

---

## WorkCenters.list
> target: packages/frontend/src/data/work-center/work-centers.test.ts
> plan-task: 9

### happy path
- 250 active work centers, `workCentersListOptions(api, { status: 'active' })` → its `queryFn` asks pages `1`, `2`, `3`, each with `limit=100` and `status=active`, and answers all 250 (the last is `WC 249`), `pagination.total` 250

### boundaries
- everything fits on one page, or there is no work center → one request

### edge cases
- [HIGH] a later page fails → the whole list rejects, never an answer with part of the list

---

## Gateway.routing
> target: apps/ui-e2e/src/routing.spec.ts
> plan-task: 10

### happy path
- `GET http://localhost/` → 200
- `GET /users` → the web app's HTML, with `id="root"` once (SPA fallback)
- `GET /operator` → 301 to `http://localhost/operator/`
- `GET /operator/select-work-center` → the panel's HTML, which references `/operator/assets/`
- `GET /version.json` → `{"version":"dev"}`
- `GET /index.html` → `Cache-Control: no-cache`

### edge cases
- [HIGH] `GET /api/v1/users/me` without a token → 401 from user-service (the API rule wins over the frontend catch-all of priority 1)
- [HIGH] `GET /api/v1/no-such-thing` → 503 `{"error":{"code":"gateway.unavailable",...}}` as JSON with `Cache-Control: no-store`, never the SPA's HTML (the answer a stopped service's paths get too)

### authorization
- [CRITICAL] `GET /internal/v1/users` → the same JSON 503 from the frontend, never a service's answer
- [CRITICAL] `GET /` → carries one `Content-Security-Policy` header
- [CRITICAL] `GET /version.json` (a location with its own `add_header`) → still carries one `Content-Security-Policy` header

---

## E2E.webAuth
> target: apps/ui-e2e/src/web-auth.spec.ts
> plan-task: 11

### happy path
- the admin signs in at `/` → sees Users, and is still signed in after a reload

### constraints
- a wrong password → stays on the login page with a message

### edge cases
- [HIGH] signed in on `/users?page=2&size=50`, `edmes.web.token` replaced with `garbage` → within 45 s the URL matches `/login?redirect=` (the heartbeat gets a 401); after signing in again the URL is `/users?page=2&size=50` and the table is visible
- [HIGH] `edmes.web.token` is `garbage` before the page loads, `goto('/')` → the URL matches `/login`

### authorization
- [CRITICAL] `seed.limited` (a role with `accessWebApp` only) → no Users entry in the navigation, and `/users` shows the no-permission state, which names the missing permission
- [CRITICAL] `seed.viewer` (the ready-made Viewer) → sees Users and no button that changes anything
- [CRITICAL] `seed.operator` (the ready-made Operator) signs in at `/` → the text `has no access to the web app` is visible; "Sign out" leads to `/login`

---

## E2E.webUsersRealtime
> target: apps/ui-e2e/src/web-users-realtime.spec.ts
> plan-task: 11

### happy path
- signed in on `/users`, `POST /api/v1/users` with the admin token → the new e-mail is visible within 5000 ms without a reload

### edge cases
- [HIGH] ten users created one after another → the last e-mail is visible within 5000 ms and the number of `/api/v1/users?` requests is at most `2 + Math.ceil(burstMs / 2000)`

---

## E2E.outage
> target: apps/ui-e2e/src/outage.spec.ts
> plan-task: 11

### edge cases
- [HIGH] signed in on `/users`, `docker compose stop user` → within 60 s a `role="status"` element with `Offline since` is visible and the URL is not `/login`
- [HIGH] then `docker compose start user` → within 60 s the table is visible again, with no new sign-in

---

## E2E.operatorStation
> target: apps/ui-e2e/src/operator-station.spec.ts
> plan-task: 11

### happy path
- `seed.operator` (one visible work center) signs in at `/operator/` → the station screen opens with `seed.workCenter.name` and `No running job order`
- `startJobOrder` through the API → the job order's code is visible within 5000 ms without a reload

### edge cases
- [HIGH] on the station screen, `edmes.operator.token` replaced with `garbage` → within 45 s the URL matches `/operator/login`; after signing in again `seed.workCenter.name` is visible and a `role="status"` element shows `Live`

---

## E2E.operatorGuards
> target: apps/ui-e2e/src/operator-guards.spec.ts
> plan-task: 11

### edge cases
- [HIGH] `seed.unassignedOperator` (`workCenterIds []`) signs in → is told that no work center is assigned, and can sign out

### authorization
- [CRITICAL] `seed.viewer` (no `accessOperatorPanel`) signs in at `/operator/` → a no-access screen with a sign-out button
- [CRITICAL] signed in to the panel, then signing in to the web app in the same browser → `edmes.web.token` and `edmes.operator.token` hold different tokens and the panel's session is not replaced

---

## Toolchain.contractAndWorkspace
> target: .github/workflows/ci.yml (the `static` job; no Vitest file)
> plan-task: 2 (emit), 3 (drift check, lockfile)

### constraints
- `pnpm openapi:emit` twice in a row → `git diff --exit-code packages/api-client/openapi` reports no diff (the output is deterministic)
- an emitted file → `JSON.stringify(document, null, 2) + '\n'` at `packages/api-client/openapi/<service>.json`
- after `pnpm install` → `pnpm-lock.yaml` has no `file:` entry for `@mes/api-client`, `@mes/frontend` or `@mes/ui`
- `EDMES_VERSION=9.9.9-check pnpm build` → the web app's `version.json` is `{"version":"9.9.9-check"}` (turbo passes `EDMES_VERSION` to the builds and keys its cache on it)

### edge cases
- [HIGH] `pnpm openapi:emit` with no `.env` and no database running → exit 0 and three JSON files
- [HIGH] a service's paths change without a re-emit → `pnpm openapi:emit && pnpm --filter @mes/api-client generate && git diff --exit-code packages/api-client` fails in CI

---

## Web.shell
> target: apps/ui-e2e/src/web-auth.spec.ts
> plan-task: 8

### happy path
- the sidebar is collapsed → a 64 px rail; the choice is written with `writePrefs` and is still there after a reload
- the top bar's plant clock → shows the server's time in `plantTimezone`, not the browser's
- `/users` first load → skeleton rows; a later refetch or page change keeps the current rows until the new ones arrive
- `/users` → page, size, sort and search are in the URL only; a reload shows the same page
- Log out in the user menu → the login page opens with the current address in `redirect`

### boundaries
- viewport narrower than 1100 px → the sidebar starts as the rail

### constraints
- realtime `connecting` or `reconnecting` → the indicator shows `reconnecting`; session `unreachable` or realtime `unavailable` → `offline` with `Offline since HH:mm` from the time that state began, shown in server time (a device clock that is off does not shift it); otherwise `live`
- the session status is `unknown` (bootstrap pending) → the app renders at once with a loading state, never a blank page
- `/users` fails to load → `PageError` with the error's `traceId`
- `/version.json` reports another version → a toast with a reload action

### edge cases
- [HIGH] any page load → no request leaves the origin (fonts, scripts and icons are bundled)

---

## Web.shellOutage
> target: apps/ui-e2e/src/outage.spec.ts
> plan-task: 8

### edge cases
- [HIGH] status `unreachable` with a user in the session → the layout keeps rendering with a `role="status"` banner `Server unreachable, retrying`; no redirect to `/login`
- [HIGH] status `unreachable` without a user (the page was loaded during an outage) → the same message full-screen, `session.bootstrap()` every 5 s, and the app opens when it answers 200

---

## Operator.shellOutage
> target: apps/ui-e2e/src/outage.spec.ts
> plan-task: 9

### edge cases
- [HIGH] status `unreachable` with a user in the session → the station keeps rendering under the banner of `common.unreachable` (`Server unreachable, retrying`); no redirect to `/operator/login`
- [HIGH] status `unreachable` without a user (the tablet started during an outage) → the same message full-screen, `session.bootstrap()` every 5 s, and the station opens when it answers 200

### authorization
- [CRITICAL] status `unreachable` without a user → the unreachable message is shown, never the no-access screen: the `accessOperatorPanel` check is not reached with an empty permission list

RESOLVED: Status `unreachable` in the operator panel behaves as in the web app and is checked before the permission (reason: a tablet started during an outage must show "server unreachable", not "no access").

---

## Operator.shell
> target: apps/ui-e2e/src/operator-station.spec.ts
> plan-task: 9

### happy path
- nothing stored and several visible work centers → the picker lists them; choosing one stores it under `edmes.operator.station` and opens the station screen
- `index.html` → `<html data-density="touch">`

### edge cases
- [HIGH] the gateway refuses the station's room (`onRoomsDenied` contains `wc:<id>`) → `station.clear()` and the picker opens
- [HIGH] `/version.json` reports another version → the panel reloads only when `queryClient.isMutating()` is 0 and no `[role="dialog"]` is in the document

---

## Gateway.nginx
> target: apps/ui-e2e/src/routing.spec.ts
> plan-task: 10

### happy path
- `GET /healthz` → 200
- a file under `assets/` → `Cache-Control: public, max-age=31536000, immutable`
- `GET /version.json` → `Cache-Control: no-cache`
- `GET /uploads/<file>` through Traefik → answered by user-service, not by the frontend

### constraints
- a request that reaches nginx under `/api`, `/internal`, `/socket.io`, `/docs` or `/uploads` → 503, `Content-Type: application/json`, `Cache-Control: no-store`, body `{"error":{"code":"gateway.unavailable","message":"Service unavailable"}}`, never `index.html` (a stopped service's router is gone, so the catch-all answers; clients treat it like any 5xx)

### authorization
- [CRITICAL] the `Content-Security-Policy` value → `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
- [CRITICAL] a file under `/assets/` or `/operator/assets/` (locations with their own `add_header`) → still carries the `Content-Security-Policy` header
