# Coverage Map — frontend-foundation
Generated: 2026-11-26

Contract: docs/test-scenarios/frontend-foundation.md (301 bullets). The owner decided on 2026-11-26 that the no-permission screen names the missing permission. An existing test stands for a bullet only where it asserts all of it; otherwise the bullet got a new test. Paths are relative to the area's package unless written in full.

## Backend (user service, OpenAPI documents, CI static job)

| Scenario | Test location | Status |
|----------|--------------|--------|
| UsersMe.permissions / happy / one role, sorted permissions | R:185 | ✅ |
| UsersMe.permissions / happy / plantTimezone and serverTime beside permissions | R:200 | ✅ |
| UsersMe.permissions / boundaries / no roles -> [] | R:237 (existing) | ✅ |
| UsersMe.permissions / authorization / two users, own permissions | R:214 | ✅ |
| UsersMe.permissions / authorization / login and /users/me hide counters | R:247 (existing) | ✅ |
| Privileges / accessWebApp valid | R:280 (existing, one it for three bullets) | ✅ |
| Privileges / accessOperatorPanel valid | R:280 (existing) | ✅ |
| Privileges / no *Screen codes | R:280 (existing) | ✅ |
| Privileges / APPLICATION_PRIVILEGES exact | R:287 | ✅ |
| Privileges / order of PRIVILEGES | R:295 | ✅ |
| DefaultRoles.firstInstall / five keys | D:62 (existing) | ✅ |
| firstInstall / names | D:133 | ✅ |
| firstInstall / defaultPermissions equals permissions | D:145 | ✅ |
| firstInstall / planner exact | D:154 | ✅ |
| firstInstall / shiftSupervisor exact | D:171 | ✅ |
| firstInstall / quality exact | D:192 | ✅ |
| firstInstall / operator exact | D:206 | ✅ |
| firstInstall / viewer = accessWebApp + read* | D:74 (existing) | ✅ |
| firstInstall / role.created emitted, same path as ensureSystemAdminRole | D:28 (existing; asserts emit per role id, "same path" not asserted separately) | ✅ (see note) |
| firstInstall / valid privilege codes | D:89 (existing) | ✅ |
| firstInstall / READ computed from PRIVILEGES | D:237 | ✅ |
| firstInstall / existing key -> only missing created | D:48 (existing) | ✅ |
| firstInstall / duplicate key rejected | D:245 | ✅ |
| firstInstall / several roles without key | D:253 | ✅ |
| firstInstall / [CRITICAL] operator panel not web app | D:67 (existing) | ✅ |
| firstInstall / [CRITICAL] viewer read-only | D:74 (existing) | ✅ |
| firstInstall / [CRITICAL] only shiftSupervisor has both | D:262 | ✅ |
| laterRuns / viewer lacks readOee -> permissions gets it | D:116 (existing) | ✅ |
| laterRuns / defaultPermissions equals current definition | D:277 | ✅ |
| laterRuns / added code emits role.updated | D:116 (existing) | ✅ |
| laterRuns / no role, false -> none created | D:93 (existing) | ✅ |
| laterRuns / renamed role still gets new code | D:290 | ✅ |
| laterRuns / [HIGH] quality deleted not recreated | D:99 (existing) | ✅ |
| laterRuns / [HIGH] planner renamed, code pulled, kept | D:105 (existing) | ✅ |
| laterRuns / [HIGH] readOee added once | D:116 (existing) | ✅ |
| laterRuns / [HIGH] customer extra code stays | D:305 | ✅ |
| loaderOrder / empty db -> five roles + admin role | S:259 | ✅ |
| loaderOrder / admin role exists -> no ready-made role | S:270 | ✅ |
| loaderOrder / bootstrap disabled -> nothing | S:280 | ✅ |
| loaderOrder / [HIGH] interrupted first start finished | S:202 (existing) | ✅ |
| loaderOrder / [HIGH] quality deleted after first start | S:193 (existing) | ✅ |
| OpenApi user / every route documented | U:24 (existing) | ✅ |
| OpenApi user / /users/me meta.permissions | U:35 | ✅ |
| OpenApi user / login user without counters | U:42 | ✅ |
| OpenApi work-center / paths contain /work-centers and /{id} | W:9 (existing) | ✅ |
| OpenApi production / /job-orders get parameters | P:9 (existing) | ✅ |
| OpenApi production / /job-orders/{id} has get | P:9 (existing) | ✅ |
| Toolchain / emit twice, no diff | ci.yml:43 (second emit, git diff --exit-code) | ✅ |
| Toolchain / emitted file is JSON.stringify(doc,null,2) plus a final newline | ci.yml:46 | ✅ |
| Toolchain / no `file:` entry for @mes/api-client, frontend, ui in lockfile | ci.yml:49 | ✅ |
| Toolchain / EDMES_VERSION=9.9.9-check build -> version.json | ci.yml:52 | ✅ |
| Toolchain / [HIGH] emit with no .env and no database | ci.yml:40 (static job has no .env step, no service containers) | ✅ |
| Toolchain / [HIGH] unemitted path change fails CI | ci.yml:40 (emit && generate && git diff --exit-code && untracked check) | ✅ |

## API client, session, time, version, i18n, domain, data

| Scenario | Test location | Status |
|----------|--------------|--------|
| ApiClient.request / happy path / Bearer tkn and Accept-Language tr | client.test.ts:63 (existing) | ✅ |
| ApiClient.request / constraints / getToken null → no Authorization | client.test.ts:71 (existing) | ✅ |
| ApiClient.request / constraints / 400 validation envelope → ApiError with all fields | client.test.ts:302 | ✅ |
| ApiClient.request / constraints / X-Trace-Id → error.traceId | client.test.ts:97 (existing) | ✅ |
| ApiClient.request / edge cases / connection refused → network | client.test.ts:138 (existing) | ✅ |
| ApiClient.request / edge cases / 200 ms answer, timeoutMs 50 → timeout | client.test.ts:149 (existing) | ✅ |
| ApiClient.request / edge cases / 502 text/plain → client.unexpected_response | client.test.ts:159 (existing) | ✅ |
| ApiClient.request / edge cases / 503 auth.unavailable, no onUnauthorized | client.test.ts:128 (existing) | ✅ |
| ApiClient.request / edge cases / 503 gateway.unavailable JSON, no onUnauthorized | client.test.ts:173 (existing) | ✅ |
| ApiClient.request / edge cases / caller abort → original AbortError | client.test.ts:205 (existing) | ✅ |
| ApiClient.request / edge cases / isAbortError true/false | client.test.ts:261 (existing) | ✅ |
| ApiClient.request / edge cases / toApiError(AbortError) → aborted ApiError | client.test.ts:325 | ✅ |
| ApiClient.request / edge cases / toApiError of 'boom', undefined, null, 42 | client.test.ts:393 (existing) | ✅ |
| ApiClient.request / authorization / 401 auth.unauthenticated on any path → once | client.test.ts:335 (it.each, 3 paths) | ✅ |
| ApiClient.request / authorization / 401 other code from /auth/login | client.test.ts:355 | ✅ |
| ApiClient.request / authorization / 401 other code on another path | client.test.ts:377 | ✅ |
| ApiClient.request / authorization / sent with old token, current new → not called | client.test.ts:219 (existing) | ✅ |
| ApiClient.request / authorization / sent without token → not called | client.test.ts:254 (existing) | ✅ |
| ApiClient.request / authorization / two requests same token → called once | client.test.ts:233 (existing) | ✅ |
| JobOrder.runtimeState / happy path / {} → pending | domain/job-order.test.ts:5 (existing) | ✅ |
| JobOrder.runtimeState / happy path / startTime → running | domain/job-order.test.ts:10 (existing) | ✅ |
| JobOrder.runtimeState / happy path / both → finished | domain/job-order.test.ts:14 (existing) | ✅ |
| JobOrder.runtimeState / boundaries / null, null → pending | domain/job-order.test.ts:24 | ✅ |
| Quantity.good / happy path / 1000, 40, -10 → 950 | domain/quantity.test.ts:4 (existing) | ✅ |
| Time.format / happy path / formatInstant Istanbul → 15:30 | time/format.test.ts:22 (existing) | ✅ |
| Time.format / happy path / plantLocalToInstant Istanbul | time/format.test.ts:34 (existing) | ✅ |
| Time.format / constraints / isUtcInstant with Z → true | time/format.test.ts:5 (existing) | ✅ |
| Time.format / constraints / isUtcInstant without offset → false | time/format.test.ts:16 | ✅ |
| Time.format / edge cases / non-existent local time resolves forward | time/format.test.ts:40 (existing) | ✅ |
| Time.format / edge cases / repeated local time → first | time/format.test.ts:46 (existing) | ✅ |
| Time.serverClock / edge cases / toIso after 1000 ms | time/server-clock.test.ts:12 (existing) | ✅ |
| Time.serverClock / edge cases / fromDevice | time/server-clock.test.ts:20 (existing) | ✅ |
| Version.check / happy path / 1.1.0 vs 1.0.0, one check → onMismatch('1.1.0') | version/version-check.test.ts:139 | ✅ |
| Version.check / happy path / equal version → not called | version/version-check.test.ts:54 (existing) | ✅ |
| Version.check / boundaries / three checks of 1.1.0 → once in total | version/version-check.test.ts:37 (existing) | ✅ |
| Version.check / boundaries / later 1.2.0 → once more with '1.2.0' | version/version-check.test.ts:148 | ✅ |
| Version.check / constraints / no intervalMs → every 300000 ms | version/version-check.test.ts:161 | ✅ |
| Version.check / edge cases / port closed → silent, no reject | version/version-check.test.ts:72 (existing) | ✅ |
| Version.check / edge cases / 502 text/html → silent, no reject | version/version-check.test.ts:61 (existing) | ✅ |
| Version.chunkReloadGuard / edge cases / dispatched twice → reload once | version/chunk-reload-guard.test.ts:15 (existing) | ✅ |
| Version.chunkReloadGuard / edge cases / same version after reload → no reload, default not prevented | version/chunk-reload-guard.test.ts:24 (existing) | ✅ |
| Version.chunkReloadGuard / edge cases / later version → once, prevented; third guard → none | version/chunk-reload-guard.test.ts:40 (existing) | ✅ |
| Version.chunkReloadGuard / edge cases / storage throws → no reload, not prevented | version/chunk-reload-guard.test.ts:72 (existing) | ✅ |
| Version.reloadWhenIdle / edge cases / busy twice then idle → reload once, after | version/reload-when-idle.test.ts:12 (existing) | ✅ |
| SessionStore.bootstrap / state transitions / before bootstrap → unknown | session/session-store.test.ts:455 | ✅ |
| SessionStore.bootstrap / state transitions / no token → anonymous, no request | session/session-store.test.ts:114 (existing) | ✅ |
| SessionStore.bootstrap / state transitions / 200 → authenticated, plantTimezone, permissions, serverClock | session/session-store.test.ts:122 (existing) | ✅ |
| SessionStore.bootstrap / state transitions / 503 then 200 → unreachable, authenticated | session/session-store.test.ts:162 (existing) | ✅ |
| SessionStore.bootstrap / edge cases / 503 auth.unavailable → unreachable, token kept | session/session-store.test.ts:145 (existing) | ✅ |
| SessionStore.bootstrap / edge cases / closed port → unreachable, token kept | session/session-store.test.ts:153 (existing) | ✅ |
| SessionStore.bootstrap / edge cases / 401 other code → unreachable, token kept | session/session-store.test.ts:463 | ✅ |
| SessionStore.bootstrap / edge cases / token replaced while waiting → new user authenticated | session/session-store.test.ts:422 (existing, row `replaced`) | ✅ |
| SessionStore.bootstrap / edge cases / token removed while waiting → anonymous | session/session-store.test.ts:422 (existing, row `removed`) | ✅ |
| SessionStore.bootstrap / authorization / 401 auth.unauthenticated → anonymous, token null | session/session-store.test.ts:137 (existing) | ✅ |
| SessionStore.bootstrap / authorization / other tab removes token → anonymous | session/session-store.test.ts:371 (existing) | ✅ |
| SessionStore.bootstrap / authorization / other tab stores other user's token → unknown, then new user | session/session-store.test.ts:389 (existing) | ✅ |
| SessionStore.login / happy path / token stored under storageKey, authenticated | session/session-store.test.ts:472 | ✅ |
| SessionStore.login / happy path / value replaced in storage → getToken returns it | session/session-store.test.ts:485 | ✅ |
| SessionStore.login / constraints / wrong password → ApiError, nothing stored, anonymous | session/session-store.test.ts:180 (existing) | ✅ |
| SessionStore.login / constraints / 429 → ApiError auth.account_temporarily_locked | session/session-store.test.ts:495 | ✅ |
| SessionStore.login / edge cases / follow-up /users/me 503 → resolves, unreachable, then authenticated | session/session-store.test.ts:346 (existing) | ✅ |
| SessionStore.login / authorization / operator key only | session/session-store.test.ts:171 (existing) | ✅ |
| SessionStore.refreshAndLogout / happy path / refresh → state holds new permissions | session/session-store.test.ts:509 | ✅ |
| SessionStore.refreshAndLogout / happy path / serverClock replaced on every refresh | session/session-store.test.ts:249 (existing) | ✅ |
| SessionStore.refreshAndLogout / happy path / logout → anonymous, all dropped | session/session-store.test.ts:519 | ✅ |
| SessionStore.refreshAndLogout / edge cases / refresh 503 → unreachable, kept | session/session-store.test.ts:261 (existing, row `503`) | ✅ |
| SessionStore.refreshAndLogout / edge cases / refresh 404 HTML → unreachable, kept | session/session-store.test.ts:261 (existing, row `a 404 html page`) | ✅ |
| SessionStore.refreshAndLogout / edge cases / refresh no answer → unreachable, kept | session/session-store.test.ts:261 (existing, row `nothing at all`) | ✅ |
| SessionStore.refreshAndLogout / edge cases / unreachable, next refresh 200 → authenticated | session/session-store.test.ts:531 | ✅ |
| SessionStore.refreshAndLogout / authorization / later request 401 auth.unauthenticated → anonymous, token null | session/session-store.test.ts:205 (existing) | ✅ |
| SessionStore.refreshAndLogout / authorization / refresh 401 auth.unauthenticated → anonymous, token removed | session/session-store.test.ts:217 (existing) | ✅ |
| SessionStore.refreshAndLogout / authorization / later request 401 other code → stays authenticated | session/session-store.test.ts:542 | ✅ |
| SessionStore.refreshAndLogout / authorization / other tab removes token, refresh → anonymous, no request | session/session-store.test.ts:379 (existing) | ✅ |
| SessionStore.refreshAndLogout / authorization / other tab's token, refresh 503 → unreachable without identity | session/session-store.test.ts:407 (existing) | ✅ |
| SessionStore.can / authorization / can('readUsers') true | session/session-store.test.ts:558 | ✅ |
| SessionStore.can / authorization / can('writeUsers') false | session/session-store.test.ts:567 | ✅ |
| SessionStore.can / authorization / '*' → true for any code | session/session-store.test.ts:576 | ✅ |
| SessionStore.can / authorization / misspelled code does not compile | session/session-store.test.ts:590 (tsc --noEmit clean) | ✅ |
| Web.usersListSearch / happy path / toUsersQuery | data/user/users.test.ts:6 (existing) | ✅ |
| Web.usersListSearch / boundaries / { page: '3', size: 7 } → { page: 3, size: 20 } | data/user/users.test.ts:18 (existing) | ✅ |
| Web.usersListSearch / boundaries / page 0 or non-numeric → 1 | data/user/users.test.ts:36 | ✅ |
| Web.usersListSearch / boundaries / size 20, 50, 100 kept, other → 20 | data/user/users.test.ts:42 | ✅ |
| Web.usersListSearch / boundaries / search 100 accepted, 101 dropped, no throw | data/user/users.test.ts:52 | ✅ |
| Web.usersListSearch / boundaries / sort 5 → dropped, no throw | data/user/users.test.ts:24 (existing) | ✅ |
| I18n.resolveLanguage / happy path / user wins | i18n/resolve-language.test.ts:5 (existing) | ✅ |
| I18n.resolveLanguage / happy path / stored before browser | i18n/resolve-language.test.ts:9 (existing) | ✅ |
| I18n.resolveLanguage / happy path / browser tr-TR | i18n/resolve-language.test.ts:13 (existing) | ✅ |
| I18n.resolveLanguage / boundaries / de-DE → en | i18n/resolve-language.test.ts:17 (existing) | ✅ |
| WorkCenters.list / happy path / 250 → pages 1, 2, 3, limit 100, status active | data/work-center/work-centers.test.ts:74 (existing) | ✅ |
| WorkCenters.list / boundaries / one page or none → one request | data/work-center/work-centers.test.ts:90 (it.each: 37 and 0) | ✅ |
| WorkCenters.list / edge cases / a later page fails → whole list rejects | data/work-center/work-centers.test.ts:102 (existing) | ✅ |

## Realtime client, app core, UI components

| Scenario | Test location | Status |
|----------|--------------|--------|
| RealtimeClient.rooms / happy / subscribe wc:a then wc:b, job_order → last join is the union | rc:197 (existing) | ✅ |
| RealtimeClient.rooms / happy / only subscriber of a room unsubscribes → next join without it | rc:578 | ✅ |
| RealtimeClient.rooms / constraints / room with two subscribers stays until the last leaves | rc:208 (existing) | ✅ |
| RealtimeClient.rooms / constraints / several subscribe/unsubscribe in one microtask → one join | rc:592 | ✅ |
| RealtimeClient.rooms / constraints / transports ['websocket'] → connects to WebSocket-only server | rc:608 | ✅ |
| RealtimeClient.rooms / constraints / ack ['job_order'] for ['job_order','wc:x'] → onRoomsDenied(['wc:x']) | rc:429 (existing) | ✅ |
| RealtimeClient.rooms / edge / connection drops and returns → second join with same rooms | rc:345 (existing) | ✅ |
| RealtimeClient.rooms / authorization [CRITICAL] / each handshake carries the current token | rc:439 (existing) | ✅ |
| RealtimeClient.invalidation / happy / invalidationMap rows | rc:185 | ✅ |
| RealtimeClient.invalidation / happy / pathsForEvent('work_center.shift.started') → map.work_center | rc:146 (existing) | ✅ |
| RealtimeClient.invalidation / happy / job_order.started invalidates both job order queries, not users | rc:223 (existing) | ✅ |
| RealtimeClient.invalidation / happy / on() hands the payload; returned function removes it | rc:616 | ✅ |
| RealtimeClient.invalidation / constraints / entity with no row → no query invalidated | rc:634 | ✅ |
| RealtimeClient.invalidation / constraints / queryKey[0] not 'get' → not matched | rc:657 | ✅ |
| RealtimeClient.invalidation / constraints / path neither equal nor `<path>/` prefix → not matched | rc:674 | ✅ |
| RealtimeClient.invalidation / constraints / eventWorkCenterIds | rc:153 (existing) | ✅ |
| RealtimeClient.invalidation / constraints / queryWorkCenterIds | rc:166 (existing) | ✅ |
| RealtimeClient.invalidation / constraints / wc1, wc2,wc3, unscoped; event wc2 → {1, 2, 2} | rc:243 (existing) | ✅ |
| RealtimeClient.invalidation / constraints / event naming no work center → every matched query refetches | rc:694 | ✅ |
| RealtimeClient.invalidation / constraints / meta realtime:false, ten events → queryFn once | rc:315 (existing) | ✅ |
| RealtimeClient.invalidation / constraints / unobserved cached query → not fetched, isInvalidated | rc:330 (existing) | ✅ |
| RealtimeClient.invalidation / boundaries / throttleMs 200, ten user.updated → 3 calls, still 3 at +400 ms | rc:303 (existing) | ✅ |
| RealtimeClient.invalidation / boundaries / two matched queries, one event → each its own leading refetch | rc:721 | ✅ |
| RealtimeClient.invalidation / edge [HIGH] / previousWorkCenterId → both wc1 and wc2,wc3 refetch | rc:271 (existing) | ✅ |
| RealtimeClient.invalidation / edge [HIGH] / running refetch not aborted, one more after it settles | rc:467 (existing) | ✅ |
| RealtimeClient.connection / state / start() → idle, connecting, live | rc:737 | ✅ |
| RealtimeClient.connection / state / live, drop → reconnecting, getStatusSince moves to its start | rc:746 | ✅ |
| RealtimeClient.connection / boundaries / clean first connect → no query invalidated | rc:768 | ✅ |
| RealtimeClient.connection / edge [HIGH] / non-first connect → every observed query once more, unthrottled | rc:785 | ✅ |
| RealtimeClient.connection / edge [HIGH] / first attempt refused, later connect → refetch incl. realtime:false | rc:528 (existing) | ✅ |
| RealtimeClient.connection / edge [HIGH] / serverSocket.disconnect(true) → connects again | rc:419 (existing) | ✅ |
| RealtimeClient.connection / edge [HIGH] / two auth.unavailable then accept → no onUnauthenticated, unavailable + live | rc:407 (existing) | ✅ |
| RealtimeClient.connection / edge [HIGH] / auth.unavailable → new attempt after retryDelayMs | rc:809 | ✅ |
| RealtimeClient.connection / edge / unavailable, retryDelayMs 60000, retryNow() → connects at once | rc:384 (existing) | ✅ |
| RealtimeClient.connection / authorization [CRITICAL] / auth.unauthenticated → onUnauthenticated once, no attempt in 3 × retryDelayMs | rc:396 (existing) | ✅ |
| AppCore / happy / session authenticated → realtime started | ac:418 | ✅ |
| AppCore / happy / role.updated for a held role → second GET /users/me | ac:190 (existing) | ✅ |
| AppCore / happy / any other role.* for a held role → session.refresh() | ac:430 | ✅ |
| AppCore / happy / user.updated for the signed-in user → session.refresh() | ac:439 | ✅ |
| AppCore / happy / staleTime 30000 | ac:446 | ✅ |
| AppCore / constraints / role.updated for a role not held → no GET /users/me | ac:452 | ✅ |
| AppCore / constraints / user.updated for another user → no GET /users/me | ac:463 | ✅ |
| AppCore / constraints / anonymous → no heartbeat | ac:474 | ✅ |
| AppCore / constraints / query fails kind http (500) → not retried | ac:492 | ✅ |
| AppCore / constraints / query fails kind network or timeout → retried twice | ac:512 | ✅ |
| AppCore / constraints / query fails kind aborted → not retried | ac:541 | ✅ |
| AppCore / constraints / createAppCore({ onRoomsDenied }) → onRoomsDenied(['wc:x']) | ac:563 | ✅ |
| AppCore / constraints / storage event for another key or storage area → ignored | ac:359 (existing) | ✅ |
| AppCore / edge [HIGH] / heartbeat 200, 503, 503, 200 → authenticated, unreachable, authenticated | ac:211 (existing) | ✅ |
| AppCore / edge [HIGH] / heartbeat 401 auth.unauthenticated → anonymous | ac:223 (existing) | ✅ |
| AppCore / edge [HIGH] / POST answering 500 requested exactly once | ac:248 (existing `it.each`, row 'a 500') | ✅ |
| AppCore / authorization [CRITICAL] / web → edmes.web.token, operator → edmes.operator.token | ac:575 | ✅ |
| AppCore / authorization [CRITICAL] / session ends (logout or 401) → cache cleared, realtime stopped | ac:595 | ✅ |
| AppCore / authorization [CRITICAL] / realtime reports auth.unauthenticated → logout, anonymous | ac:627 | ✅ |
| AppCore / authorization [CRITICAL] / another tab removes the token (key or key null) → anonymous, cleared, idle, no GET | ac:381 | ✅ |
| AppCore / authorization [CRITICAL] / another tab stores another user's token → no old data, new identity, socket rejoins | ac:340 (existing) | ✅ |
| AppCore / authorization [HIGH] / token gone without a storage event, heartbeat 50 → anonymous, cleared, idle, no more GET | ac:368 (existing) | ✅ |
| Ui.Button / happy / default → 36 px | btn:7 (existing) | ✅ |
| Ui.Button / happy / data-density="touch" → 56 px | btn:38 | ✅ |
| Ui.Button / boundaries / size sm → 28 px | btn:14 (existing) | ✅ |
| Ui.Button / boundaries / size sm under touch → 48 px | btn:45 | ✅ |
| Ui.Button / constraints / pending → disabled, aria-busy="true", spinner | btn:52 | ✅ |
| Ui.Button / constraints / pending, forced click → onClick not called | btn:21 (existing) | ✅ |
| Ui.ConnectionIndicator / happy / offline label in role="status" | ci:6 (existing) | ✅ |
| Ui.StatePill / constraints / data-shape play, octagon, pause, ring | pill:6 (existing) | ✅ |

## Web app and operator panel

| Scenario | Test location | Status |
|----------|--------------|--------|
| Web.navigation / [CRITICAL] none visible → [] | web/src/navigation.test.ts:5 | ✅ |
| Web.navigation / [CRITICAL] readUsers → ['/users'] | web/src/navigation.test.ts:9 | ✅ |
| Web.prefs / write then read u1, key edmes.web.prefs.u1 | web/src/prefs.test.ts:14 (new) | ✅ |
| Web.prefs / u2 nothing stored → full | web/src/prefs.test.ts:21 | ✅ |
| Web.prefs / [HIGH] broken JSON u3 → full | web/src/prefs.test.ts:28 | ✅ |
| Web.safeRedirect / '/users?page=2' kept | web/src/safe-redirect.test.ts:5 | ✅ |
| Web.safeRedirect / undefined → '/' | web/src/safe-redirect.test.ts:16 | ✅ |
| Web.safeRedirect / [CRITICAL] https://evil.example/ → '/' | web/src/safe-redirect.test.ts:9 | ✅ |
| Web.safeRedirect / [CRITICAL] //evil.example/ → '/' | web/src/safe-redirect.test.ts:9 | ✅ |
| Web.UsersTable / two emails visible | web/src/features/users/users-table.browser.test.tsx:43 | ✅ |
| Web.UsersTable / Next → onPageChange(2) | web/src/features/users/users-table.browser.test.tsx:72 | ✅ |
| Web.UsersTable / size 50 → onSizeChange(50) | web/src/features/users/users-table.browser.test.tsx:88 | ✅ |
| Web.UsersTable / rows [] → users.empty | web/src/features/users/users-table.browser.test.tsx:60 | ✅ |
| Web.PageState / PageError reference + Try again | web/src/components/page-state.browser.test.tsx:27 | ✅ |
| Web.PageState / NoPermission onSignOut | web/src/components/page-state.browser.test.tsx:43 | ✅ |
| Web.PageState / [HIGH] 503 gateway.unavailable translated, every locale | web/src/components/page-state.browser.test.tsx:10 | ✅ |
| Web.LoginForm / 401 message + button enabled | web/src/features/auth/login-form.browser.test.tsx:34 | ✅ |
| Web.LoginForm / lockout message | web/src/features/auth/login-form.browser.test.tsx:13 | ✅ |
| Web.LoginForm / [HIGH] two quick clicks → once | web/src/features/auth/login-form.browser.test.tsx:83 | ✅ |
| Web.LoginForm / [HIGH] 503 gateway.unavailable text | web/src/features/auth/login-form.browser.test.tsx:64 | ✅ |
| Operator.LoginForm / [HIGH] 503 gateway.unavailable text | operator/src/features/auth/login-form.browser.test.tsx:7 | ✅ |
| Operator.stationStore / select wc1, reconcile → kept | operator/src/station/station-store.test.ts:22 | ✅ |
| Operator.stationStore / nothing stored, [wc1] → auto-selected | operator/src/station/station-store.test.ts:33 | ✅ |
| Operator.stationStore / new store over same storage returns wc1, key | operator/src/station/station-store.test.ts:44 (new) | ✅ |
| Operator.stationStore / nothing stored, [wc1, wc2] → none | operator/src/station/station-store.test.ts:38 | ✅ |
| Operator.stationStore / nothing stored, [] → none | operator/src/station/station-store.test.ts:38 | ✅ |
| Operator.stationStore / [HIGH] wc9 cleared | operator/src/station/station-store.test.ts:27 | ✅ |
| Operator.stationStore / [HIGH] survives sign-out | operator/src/station/station-store.test.ts:50 | ✅ |
| Operator.WorkCenterPicker / two buttons ≥ 48 px | operator/src/features/station/work-center-picker.browser.test.tsx:31 | ✅ |
| Operator.WorkCenterPicker / [HIGH] empty: text, no spinner, Sign out once | operator/src/features/station/work-center-picker.browser.test.tsx:19 (new) | ✅ |
| Operator.CurrentJobOrder / code and target shown | operator/src/features/station/current-job-order.browser.test.tsx:33 | ✅ |
| Operator.CurrentJobOrder / null → No running job order | operator/src/features/station/current-job-order.browser.test.tsx:28 | ✅ |
| Operator.stationQueries / [HIGH] work centers 503 then 200 | operator/src/station/station-queries.test.ts:55 | ✅ |
| Operator.stationQueries / [HIGH] job order 502 then 200 | operator/src/station/station-queries.test.ts:70 | ✅ |
| Operator.stationQueries / [HIGH] gateway 503 twice then 200, 3 requests, unavailable | operator/src/station/station-queries.test.ts:85 (it.each, both routes) | ✅ |
| Operator.stationQueries / 403 not asked again | operator/src/station/station-queries.test.ts:109 | ✅ |
| Operator.stationQueries / unobserved stops asking | operator/src/station/station-queries.test.ts:122 | ✅ |

## UI end-to-end (Playwright, whole stack)

| Scenario | Test location | Status |
|----------|--------------|--------|
| Gateway.routing / happy path / `GET /` → 200 | routing.spec.ts:39 | ✅ |
| Gateway.routing / happy path / `GET /users` → web app HTML, `id="root"` once | routing.spec.ts:45 | ✅ |
| Gateway.routing / happy path / `GET /operator` → 301 to `/operator/` | routing.spec.ts:53 | ✅ |
| Gateway.routing / happy path / `GET /operator/select-work-center` → panel HTML with `/operator/assets/` | routing.spec.ts:61 | ✅ |
| Gateway.routing / happy path / `GET /version.json` → `{"version":"dev"}` | routing.spec.ts:67 | ✅ |
| Gateway.routing / happy path / `GET /index.html` → `Cache-Control: no-cache` | routing.spec.ts:73 | ✅ |
| Gateway.routing / edge cases / `/api/v1/users/me` without token → 401 from user-service | routing.spec.ts:83 | ✅ |
| Gateway.routing / edge cases / `/api/v1/no-such-thing` → JSON 503, `no-store`, never SPA HTML | routing.spec.ts:90 | ✅ |
| Gateway.routing / authorization / `/internal/v1/users` → frontend JSON 503 | routing.spec.ts:95 | ✅ |
| Gateway.routing / authorization / `GET /` → one CSP header | routing.spec.ts:122 | ✅ |
| Gateway.routing / authorization / `GET /version.json` → one CSP header | routing.spec.ts:128 | ✅ |
| Gateway.nginx / happy path / `GET /healthz` → 200 | routing.spec.ts:79 | ✅ |
| Gateway.nginx / happy path / `assets/` file → `public, max-age=31536000, immutable` | routing.spec.ts:132 | ✅ |
| Gateway.nginx / happy path / `/version.json` → `Cache-Control: no-cache` | routing.spec.ts:67 | ✅ |
| Gateway.nginx / happy path / `/uploads/<file>` answered by user-service | routing.spec.ts:101 | ✅ |
| Gateway.nginx / constraints / nginx under `/api`, `/internal`, `/socket.io`, `/docs`, `/uploads` → JSON 503 | routing.spec.ts:109 | ✅ |
| Gateway.nginx / authorization / CSP value exactly the agreed one | routing.spec.ts:122 | ✅ |
| Gateway.nginx / authorization / `/assets/` and `/operator/assets/` still carry CSP | routing.spec.ts:132 | ✅ |
| E2E.webAuth / happy path / admin signs in, sees Users, still signed in after reload | web-auth.spec.ts:32 | ✅ |
| E2E.webAuth / constraints / wrong password → stays on login with a message | web-auth.spec.ts:19 | ✅ |
| E2E.webAuth / edge cases / token replaced with `garbage` → `/login?redirect=`, back to `/users?page=2&size=50` | web-auth.spec.ts:107 | ✅ |
| E2E.webAuth / edge cases / `garbage` before load → `/login` | web-auth.spec.ts:121 | ✅ |
| E2E.webAuth / authorization / `seed.limited` → no Users entry, no-permission state naming the missing permission | web-auth.spec.ts:63 (new; :46 asserts less) | ✅ |
| E2E.webAuth / authorization / `seed.viewer` → Users, no button that changes anything | web-auth.spec.ts:80 | ✅ |
| E2E.webAuth / authorization / `seed.operator` → `has no access to the web app`, Sign out → `/login` | web-auth.spec.ts:96 | ✅ |
| Web.shell / happy path / collapsed sidebar → 64 px rail, written with `writePrefs`, kept after reload | web-auth.spec.ts:145 (new; :129 asserts less) | ✅ |
| Web.shell / happy path / plant clock shows server time in `plantTimezone` | web-auth.spec.ts:179 | ✅ |
| Web.shell / happy path / `/users` skeleton rows first, rows kept during refetch/page change | web-auth.spec.ts:208 | ✅ |
| Web.shell / happy path / `/users` page, size, sort, search in the URL only; reload same page | web-auth.spec.ts:236 | ✅ |
| Web.shell / happy path / Log out → login page with current address in `redirect` | web-auth.spec.ts:278 | ✅ |
| Web.shell / boundaries / viewport < 1100 px → rail | web-auth.spec.ts:169 | ✅ |
| Web.shell / constraints / indicator reconnecting / offline since (server time, device clock off) / live | web-auth.spec.ts:321 (new; :291 asserts less) | ✅ |
| Web.shell / constraints / session `unknown` → loading state at once, never blank | web-auth.spec.ts:410 (new) | ✅ |
| Web.shell / constraints / `/users` fails → `PageError` with `traceId` | web-auth.spec.ts:429 | ✅ |
| Web.shell / constraints / `/version.json` another version → toast with reload | web-auth.spec.ts:457 | ✅ |
| Web.shell / edge cases / no request leaves the origin | web-auth.spec.ts:473 | ✅ |
| E2E.webUsersRealtime / happy path / created user visible within 5000 ms without reload | web-users-realtime.spec.ts:5 | ✅ |
| E2E.webUsersRealtime / edge cases / ten users → last visible in 5000 ms, list requests ≤ 2 + ceil(burstMs/2000) | web-users-realtime.spec.ts:18 | ✅ |
| E2E.outage / edge cases / `compose stop user` → `Offline since` status within 60 s, not `/login` | outage.spec.ts:47 | ✅ |
| E2E.outage / edge cases / `compose start user` → table again within 60 s, no new sign-in | outage.spec.ts:47 | ✅ |
| Web.shellOutage / edge cases / unreachable with a user → layout under `Server unreachable, retrying` banner, no redirect | outage.spec.ts:47 | ✅ |
| Web.shellOutage / edge cases / unreachable without a user → full-screen, bootstrap every 5 s, opens on 200 | outage.spec.ts:106 (new; :84 asserts less) | ✅ |
| Operator.shellOutage / edge cases / unreachable with a user → station under the banner, no redirect | outage.spec.ts:135 | ✅ |
| Operator.shellOutage / edge cases / unreachable without a user → full-screen, bootstrap every 5 s, station opens on 200 | outage.spec.ts:189 (new; :158 asserts less) | ✅ |
| Operator.shellOutage / authorization / unreachable without a user → never the no-access screen | outage.spec.ts:158 | ✅ |
| E2E.operatorStation / happy path / `seed.operator` → station with work center name and `No running job order` | operator-station.spec.ts:7 | ✅ |
| E2E.operatorStation / happy path / `startJobOrder` → code visible within 5000 ms | operator-station.spec.ts:7 | ✅ |
| E2E.operatorStation / edge cases / token `garbage` → `/operator/login` within 45 s; back at station, `Live` | operator-station.spec.ts:22 | ✅ |
| Operator.shell / happy path / several work centers → picker; choice stored under `edmes.operator.station` | operator-station.spec.ts:47 | ✅ |
| Operator.shell / happy path / `index.html` → `data-density="touch"` | operator-station.spec.ts:38 | ✅ |
| Operator.shell / edge cases / room refused → `station.clear()`, picker opens | operator-station.spec.ts:68 | ✅ |
| Operator.shell / edge cases / new version → reload only when `isMutating()` is 0 and no dialog | operator-station.spec.ts:141 (new; :104 covers the dialog only) | ✅ |
| E2E.operatorGuards / edge cases / `seed.unassignedOperator` → told no work center, can sign out | operator-guards.spec.ts:4 | ✅ |
| E2E.operatorGuards / authorization / `seed.viewer` at `/operator/` → no-access screen with sign-out | operator-guards.spec.ts:13 | ✅ |
| E2E.operatorGuards / authorization / panel then web app → different tokens, panel session kept | operator-guards.spec.ts:22 | ✅ |

## Summary
- Total scenarios: 301
- Covered: 301
- Missing (CRITICAL): 0
- Missing: 0
- Bugs found: 0
- Spec mismatches (need owner confirmation): 0
