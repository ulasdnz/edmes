# Dual Frontend Architecture — Design

**Date:** 2026-11-25
**Status:** Proposed, awaiting owner review
**Implemented by:** `docs/superpowers/plans/2026-11-25-frontend-foundation.md` (foundation only; feature plans follow per module)
**Visual design:** the "Edmes Web App" Claude Design canvas, https://claude.ai/artifact/AWM1EZsqYUugoxiThFtNRn (read on 2026-11-25, still changing). It covers the web app: 54 artboards, a shared stylesheet `project/edmes.css`, and the shell components `Sidebar` and `Topbar`. It has no operator panel screens yet. Section 9 lists what this document takes from it.

## 1. Goal

EDMES gets two browser frontends:

- **Web app** — desktop, for managers and staff. Creates and configures everything: users, roles, work centers, shifts, catalog, job orders, stops, reasons, OEE.
- **Operator panel** — industrial tablets on the shop floor. Operators check in, start and end job orders, enter scrap and adjustments, and handle stops. Everything it does is also possible in the web app.

This document fixes the code architecture, the technology choices and the relationship between the two. Screen design comes separately from Claude Design and plugs into the token file and component package described in section 9.

## 2. What the backend gives a browser today

Every choice below follows from these facts, so they are listed first.

| Fact | Source | Consequence |
|---|---|---|
| Login returns a JWT in the JSON body only. No cookie, no refresh token, no logout. Lifetime `1d`. | `user/src/modules/user/user.controller.ts:24-30`, `user/src/config/index.ts:17` | The token is held by JavaScript. A session lasts at most a day. |
| Requests authenticate with `Authorization: Bearer`. | `packages/auth/src/authenticate.ts:100-105` | No CSRF surface; XSS is the risk to defend. |
| `GET /users/me` returns the user plus `meta.plantTimezone` and `meta.serverTime`, but **not** the resolved permissions. The endpoints that do need `readUsers`. | `user.controller.ts:66-80`, `user.routes.ts:100-117` | A frontend cannot tell what the user may do. Backend change B1. |
| The `access*Screen` privileges exist for some modules only (none for production or telemetry) and no route checks them. Every module has a `read*` privilege. | `packages/privileges/src/index.ts` | Screens follow the module's `read*` permission. The 15 screen codes are replaced by two application codes, `accessWebApp` and `accessOperatorPanel` (section 7). |
| One `GET /oee` request runs four stages of cross-service reads (about a dozen) and nothing is cached. A virtual work center repeats that for every contributor. There is no batch form and no hourly breakdown. | `performance/src/modules/oee/oee.service.ts:82-440` | The monitoring screens cannot be made fast in the browser alone. They read from a dedicated read API (`2026-11-25-monitoring-read-api-design.md`). |
| Every response carries an `X-Trace-Id` header. | `packages/core/src/middleware/request-context.ts:18-21` | It is the "reference for support" the design shows on an error. |
| Only user-service registers OpenAPI paths (21). Work-center, production and performance pass `{}`; telemetry serves none. The document exists only at runtime (`/docs.json`). Zod schemas are private to each service. | `user/src/core/loaders/express.ts:65-75`, `production/.../express.ts:73` | No typed contract exists for four of five services. Backend change B2. |
| Realtime is Socket.io 4.8.4, WebSocket only, token in `handshake.auth.token`. One client message, `join {rooms}`, and **each `join` replaces the previous rooms**. Payloads carry IDs only. No replay. Auth is rechecked every 30 s and a failed recheck is a server-side disconnect. | `realtime/src/gateway/socket.ts:47-166`, `router.ts:15-22` | Events are invalidation signals, not data. The client owns the full room set and refetches on every reconnect. |
| A middleware rejection is `connect_error` `auth.unauthenticated` (log out) or `auth.unavailable` (retry, stay logged in). | `socket.ts:55-70`, `docs/test-scenarios/realtime-gateway.md:133` | An outage must never log a tablet out. |
| Traefik serves plain HTTP on port 80. Nothing is routed at `/`. `/uploads` is not routed. | `docker-compose.yml:21-63,180` | No secure context: no service worker, no Screen Wake Lock, no `crypto.randomUUID`. Avatars cannot load. Backend change B3. |
| `POST /scrap-entries` and `POST /quantity-adjustments` have no idempotency key. Start, end and close are guarded by state checks and unique indexes (a repeat is a 409). | `production/src/modules/job-order/job-order.service.ts:209-304`, the scrap-entry and quantity-adjustment routes | A replayed scrap POST double-counts. No blind retry, no offline write queue. |
| A job order has no status field. `runtimeState` is derived from `startTime`/`endTime`; good quantity is gross − scrap + adjustments, computed by the client. | `docs/production-service-spec.md:273-281` | These rules must live in exactly one place both apps import. |
| There is no operator PIN, badge or kiosk identity. Operators are users; check-in is `POST /work-centers/:id/operators`. | `work-center/src/modules/operators/operators.validators.ts:4-9` | Operator login is a normal user login until the backend adds something else. |
| `apps/*` is already a workspace glob and the directory does not exist. | `pnpm-workspace.yaml:3` | The apps go in `apps/`. |
| Installs can be air-gapped. | `docs/operations/installation.md` | No CDN at runtime: fonts, icons and scripts are bundled. |

## 3. The relationship between the two apps

**Two applications, one shared core, no code path between them.**

```
apps/web  ───────┐                     ┌─────── apps/operator
(desktop shell)  │                     │  (touch shell)
                 ▼                     ▼
        ┌────────────────────────────────────────┐
        │ @mes/ui          tokens + primitives   │
        │ @mes/frontend    session, realtime,    │
        │                  data, domain, time,   │
        │                  i18n, version         │
        │ @mes/api-client  generated contract +  │
        │                  HTTP client           │
        └────────────────────────────────────────┘
                 │  REST /api/v1      ▲  Socket.io /socket.io
                 ▼                    │
              Traefik → services → Redis Streams → realtime gateway
```

- They are **separate deployables with separate bundles**, because their constraints differ: pointer and keyboard against touch with gloves, dense tables against a few large controls, an occasional visit against a screen that stays open for a whole shift. One responsive app would make every admin screen pay for the tablet and let an admin-screen regression take the shop floor down.
- They **never import each other**. Anything both need moves down into a shared package.
- They **do not talk to each other**. At runtime they are related only through the backend: an operator ends a job order on the tablet, production publishes `job_order.ended`, the gateway forwards it, and the web app's open job order list refetches. Neither app knows the other exists.
- They are **served from one origin**: the web app at `/`, the operator panel at `/operator/`. Same origin means no CORS and one API base (`/api/v1`), and it also means they share `localStorage`, so each app stores its token under its own key (`edmes.web.token`, `edmes.operator.token`). A manager signing in to the web app on a tablet does not replace the operator's session.
- They **share the permission model**. The same codes from `@mes/privileges` gate the same actions in both; a user who may not `executeJobOrders` sees no start button in either.
- **The wall display is a mode of the web app, not a third app.** The design's 1920×1080 "Live floor · wall display" is the Live floor data without the shell, paging by itself. It is a route under a bare layout in `apps/web`. It behaves like a tablet in one respect: nobody touches it for days, so it uses the same heartbeat and reload-when-idle modules as the operator panel, which is one more reason those live in the shared package.
- **The web app is responsive down to 1024 px** (the design's "Türkçe · tablet" board): the sidebar collapses to an icon rail and secondary columns move to the detail page. A supervisor using the web app on a tablet is still using the web app; the operator panel is a different product for a different job.

### What is shared and what is not

| Shared (in `packages/`) | Per app (in `apps/<app>/`) |
|---|---|
| The API contract and HTTP client | Routes and navigation |
| Query and mutation definitions for every backend module | Layouts (sidebar shell, station shell) |
| The event → invalidation table | Screens and feature components |
| Business rules (`runtimeState`, good quantity, stop states) | Forms as rendered (a desktop dialog and a touch keypad are different components over the same mutation) |
| Session, permission check, realtime client | App-specific strings |
| Time and number formatting in the plant timezone | Device behaviour (kiosk reload, station binding) |
| Design tokens and primitive components | |
| Common strings (errors, connection states, domain terms) | |

**The rule for where code goes:** if it talks to the server or encodes a business rule, it is shared. If it renders, it belongs to an app, unless it is a primitive with no domain knowledge, which goes in `@mes/ui`. The data layer mirrors the backend, not a screen, so it is shared from the first line even when only one app uses it today; tree-shaking keeps unused modules out of a bundle.

Scrap entry shows the split. `@mes/frontend/data/production/scrap-entries.ts` owns the list query, the create mutation and its invalidation. The web app renders it as a table with a dialog form. The operator panel renders it as a full-screen numeric keypad. Both get the same validation errors from the same mutation.

## 4. Technology choices

Versions are the latest published on 2026-11-25. Install with caret ranges; `minimumReleaseAge` picks the newest version at least a week old.

| Concern | Choice | Why this one |
|---|---|---|
| UI runtime | React 19.3 with the React Compiler | Largest ecosystem for every other row. The compiler memoises automatically, which matters on low-power tablets and removes hand-written `useMemo`. |
| Build | Vite 8.3 (Rolldown) + `@vitejs/plugin-react` 6 | Both apps are static SPAs behind a login. Output is plain files, so there is no Node process to run on the factory server. |
| Routing | TanStack Router 1.170, file-based, automatic code splitting | Search params are typed and validated, which is what a filterable, shareable table URL needs. Route context carries the session, so guards are declarative. |
| Server state | TanStack Query 5 | Realtime events carry IDs only, so the design is "invalidate and refetch"; Query is that model. |
| Contract | `openapi-typescript` 7 + `openapi-fetch` + `openapi-react-query` | Types generated from the services' own Zod schemas through OpenAPI, zero runtime weight, and a backend change that breaks a screen fails `pnpm typecheck`. |
| Tables | TanStack Table 9 (+ TanStack Virtual when a list needs it) | Headless, server-side pagination and sorting map directly onto `page`/`limit`/`sort`. v9 imports only the features a table uses. |
| Forms | TanStack Form 1 with Zod 4 schemas | `createFormHook` binds form state to design-system fields once per app, so the web app and the panel bind the same form logic to different field components. |
| Validation | Zod 4.6 (the version the services already resolve) | One schema library across the repo. |
| Client state | Zustand 5 (vanilla stores) | Only for what is neither server state nor URL state: the session and the panel's station binding. Non-React code (HTTP middleware, socket) reads the same store. |
| Styling | Tailwind CSS 4.3 (`@tailwindcss/vite`) | Tokens are CSS variables in one `@theme` file, which is where the Claude Design output lands. |
| Components | shadcn 4 CLI, Base UI style (`base-nova`), source in `@mes/ui`; icons from `lucide-react` at stroke width 1.75 | The design brings its own complete look (`edmes.css`). What it does not bring is behaviour: focus traps, popover placement, menu and combobox keyboard handling. Base UI 1.x supplies that, and because the component files are ours they are restyled to the design's classes instead of fought. |
| Realtime | `socket.io-client` 4.8.4 | Must match the gateway. |
| i18n | i18next 27 + react-i18next 18, `en` and `tr` | Same languages and terms as the services' own translations. |
| Dates | date-fns 4 + `@date-fns/tz` | Every instant is shown in the plant timezone from `/users/me`, never the browser's. |
| Charts | ECharts 6 (canvas, modular imports, loaded only on routes that draw a chart) for every chart with axes; plain SVG and CSS for ring gauges, progress bars, timeline lanes and shift bars | Trends needs drag-to-zoom on a region and a way back to the first range; ECharts has both, and mark lines and areas for the "now" marker, target lines and stop bands. One library covers the line and bar charts. The real speed lever is the server: the historian downsamples (`series?targetPoints`), so a chart asks for about as many points as it is pixels wide, and a zoom requests the selected range again at the same point count. Ten thousand raw points never reach the browser, and zooming in shows more detail. The Monitoring plan confirms the choice with a measured render of six series before building on it. |
| Unit and component tests | Vitest 5: a node project and a browser project (Playwright Chromium, `vitest-browser-react`) | Component tests run in a real browser, in line with the repo's rule that tests behave like production. |
| End-to-end | Playwright 1.65 against the real Compose stack | Covers Traefik, nginx, the gateway and both apps together. |
| Lint and format | Biome (the repo's 2.4.6) with `css.parser.tailwindDirectives` | No second toolchain. |
| Static server | `nginxinc/nginx-unprivileged` (alpine, digest-pinned) | Serves both apps from one container of a few MB of RAM. |

Deliberately not adopted:

- **An SSR framework (Next.js 16, TanStack Start).** Both apps sit behind a login on a LAN with no SEO and no public traffic. SSR would add a Node runtime, a second place to handle auth and nothing a user would notice.
- **Micro-frontends or module federation.** One developer, one release version, two apps.
- **A service worker or offline write queue.** See section 8.
- **TypeScript 7.** The repo runs 5.9.3 and `openapi-typescript` drives the TypeScript compiler API. Moving the monorepo to 7 is its own change. The same holds for Vitest: frontends start on 5, the services stay on 4.1 until they are upgraded together.
- **TanStack DB.** Still a release candidate.
- **A faked backend (MSW) under component tests.** A fake that drifts from the services is a lying test. See section 11.

## 5. Workspace layout

```
apps/
  web/                    web-app          Vite SPA, base /
  operator/               operator-panel   Vite SPA, base /operator/
  ui-e2e/                 ui-e2e           Playwright against the Compose stack
  Dockerfile              builds both apps into one nginx image
  nginx.conf
packages/
  api-client/             @mes/api-client  generated types + HTTP client
    openapi/<service>.json                 emitted by each service, committed
    src/generated/<service>.d.ts           generated, committed
  frontend/               @mes/frontend    subpath exports:
    src/session/                           /session
    src/realtime/                          /realtime
    src/data/<service>/<module>.ts         /data/*
    src/domain/                            /domain
    src/time/                              /time
    src/i18n/                              /i18n
    src/version/                           /version
  ui/                     @mes/ui          tokens, primitives, shadcn components
tsconfig.web.json                          base for every browser workspace
```

- The three frontend packages are **source-only**, like `@mes/testing`: `exports` point at `src`, there is no `dist`, and each app's Vite compiles them. No watch build, and a change in a package hot-reloads in both apps.
- `pnpm-workspace.yaml` gets a `catalog:` for the dependencies the frontend workspaces share (react, react-dom, the TanStack packages, zod, vitest). With `injectWorkspacePackages: true`, a workspace package stays symlinked only while its peers resolve alike in every consumer; one version source keeps that true. A `file:` entry for a frontend package in `pnpm-lock.yaml` means it was copied and hot reload is broken.
- Browser workspaces extend `tsconfig.web.json`: `moduleResolution: Bundler`, `jsx: react-jsx`, DOM libs, `noEmit`. **Imports there are extensionless.** The `.js` extension rule in `CLAUDE.md` applies to Node workspaces only; `CLAUDE.md` is updated to say so.
- `@mes/privileges` is imported by the frontends for the `PrivilegeCode` type, so a permission check with a misspelled code fails to compile.

### Inside an app

```
apps/web/src/
  main.tsx                providers: QueryClient, session, realtime, i18n, router
  router.tsx
  routes/                 file-based; a route file holds config, guard and search schema
    __root.tsx
    login.tsx
    _app.tsx              authenticated layout with the shell (sidebar, top bar)
    _app/<area>/...
    _bare.tsx             authenticated layout without the shell (wall display)
  features/<feature>/     screens and components of one area
  components/             app-level composites (DataTable, PageHeader, AppSidebar)
  locales/{en,tr}.ts
```

Dependencies point one way: `routes → features → components → @mes/ui / @mes/frontend / @mes/api-client`. A feature does not import another feature. `apps/operator` has the same shape with its own layouts.

State has four homes and each kind goes to exactly one:

| State | Home |
|---|---|
| Anything the server owns | TanStack Query |
| Filters, page, sort, selected tab, open record | URL search params |
| Session, station binding | Zustand store |
| Per-user view preferences (visible columns, collapsed sidebar) | `localStorage` under `edmes.web.prefs.<userId>`, until the backend stores them (B11) |
| Everything else | Component state |

The design fixes the URL format for lists: `/job-orders?state=pending,running&wc=INJ-01,INJ-02&due=2026-11-23..2026-11-25&sort=due&page=1&size=20`. So URL search values are plain strings, lists are comma-separated, ranges are `from..to`, and the page size is `size`. Each list has one Zod schema that parses the URL and one function that maps it to the API query (`limit`, `dueAtFrom`, `dueAtTo`, `workCenterIds`). Screens never build API queries from the URL by hand.

## 6. Contract and data layer

1. Each service exposes its OpenAPI document as a module (`src/lib/openapi/document.ts`) used by both the Express loader and a script, `pnpm --filter <service> openapi:emit`, that writes `packages/api-client/openapi/<service>.json` without starting the service.
2. `pnpm --filter @mes/api-client generate` runs `openapi-typescript` over each file into `src/generated/<service>.d.ts`. The `paths` types are intersected into one `paths`; path keys are disjoint because every service owns its own resources.
3. Both the JSON and the generated types are committed. CI regenerates and fails on a diff, so a service change that was not re-emitted cannot merge.
4. `createApiClient()` wraps `openapi-fetch` with one middleware that adds `Authorization` and `Accept-Language`, turns a 401 `auth.unauthenticated` into a logout, and leaves 503 `auth.unavailable` alone. Every failure is normalised to one `ApiError { status, code, message, details, kind }`.
5. `@mes/frontend/data/<service>/<module>.ts` exports query option factories and mutation hooks. Screens import those, never the raw client.

Coverage grows with the features. The foundation covers user-service (already registered) and the two production and work-center reads the first operator screen needs. **Each feature plan starts by registering its module's paths**; that is the step that turns an untyped service into a typed one.

Form schemas are written in the frontend and pinned to the generated request type (`satisfies z.ZodType<CreateBody>`), so a contract change breaks the build. The server stays the authority: `error.details[{ field, message }]` is mapped onto form fields by one shared helper.

## 7. Session and permissions

- The session store holds `{ user, permissions, plantTimezone, serverOffsetMs }` and a status: `unknown | authenticated | anonymous | unreachable`.
- On load, a stored token is checked with `GET /users/me`. 200 → authenticated. 401 → token cleared, anonymous. 503 or a network failure → `unreachable`: the token is **kept** and the app shows "server unreachable, retrying". Only a 401 ends a session.
- **An expired session goes to the login page and comes back to the same address.** Filters, sort and page are in the URL, so the user returns to the same view; only an unsaved form is lost. The design's in-place password dialog is not built: it would leave the previous user's data visible behind it on a shared computer, and with a one-day token an expiry in the middle of a form is rare. Backend change B7 (a session that renews itself) removes the case altogether.
- While signed in, the same request repeats every 30 seconds. That heartbeat is how an outage, the recovery from it and an expired token are noticed on a screen nobody is touching, and it keeps the server clock offset current.
- `can(code)` is true when the permission list contains the code or `*`.
- Route guards and menu items use the module's **read** permission (`readJobOrders`, `readUsers`), as the design's Roles screen states. Action controls use the code the endpoint enforces (`writeJobOrders`, `executeJobOrders`); an action the user may not take is hidden, and one that is refused by state (start on a started job order) is shown disabled with the reason. The navigation is one manifest of six groups filtered by `can`; a group with no visible item disappears.
- A page opened by direct link without the permission shows the design's "no permission" state, naming the missing permission.
- **The Overview is the start page.** It opens for anyone who holds at least one permission of the monitoring read API's sections (`state` and `stops`: `readUnplannedStops` and `readPlannedStops`; `job`: `readJobOrders`; `production`: `readJobOrders` and `readProductionAdjustments`; `oee`: `readOee`; `shift`: `readSchedules`; `operators`: `readOperators`) and draws only the columns and blocks whose sections the user may read. Its rows are the work centers assigned to the user, read from the monitoring API, so `readWorkCenters` is not needed; a user with no work center sees the empty state. `/` opens the Overview for such a user and the first permitted menu item for anyone else. Until the monitoring read API and the Overview exist, `/` opens the first permitted menu item. Decided by the owner on 2026-11-26.
- **Two application permissions decide which app a user may enter:** `accessWebApp` and `accessOperatorPanel`. They replace the 15 `access*Screen` codes. An operator's role holds `accessOperatorPanel` and `readJobOrders`: job orders are visible in the panel, and the web app answers "this account has no access to the web app" with a sign-out button. Inside an app, a screen needs nothing beyond the module's read permission, so "read without screen" and "screen without read" cannot be configured by mistake. On the Roles screen the two appear as switches above the module matrix.
- **Roles ship ready-made.** The first start of user-service creates five roles next to the system administrator: Planner, Shift Supervisor, Quality, Operator and Viewer (the roles on the design's Roles board). A customer assigns users to them and rarely edits a permission. A role the customer changed or deleted is never restored or overwritten; a privilege introduced by a later version is added once to the ready-made roles that should hold it.
- A `user.updated` or `role.updated` event that concerns the signed-in user refetches the session, so a permission change takes effect without a new login.
- The token is in `localStorage`. That is a consequence of the backend returning it in the body with no refresh endpoint: memory-only would mean a login on every reload. The defence is a strict Content-Security-Policy from nginx (`script-src 'self'`), no third-party scripts and no CDN.
- `serverOffsetMs = serverTime − Date.now()` at session load. Any timestamp the client must send is corrected by it; where the API accepts an omitted time (`POST /job-orders/:id/start`), the client omits it and lets the server stamp it.

## 8. Realtime and offline behaviour

One `RealtimeClient` per app, created after login.

- **Rooms are reference-counted.** A screen calls `subscribe(['wc:<id>'])` and gets an unsubscribe function. The client keeps the union and emits it as one `join` whenever it changes and on every connect, because the gateway replaces rooms on each `join` and remembers nothing across reconnects.
- **Events are matched to queries.** A table maps an event entity to API path prefixes (`job_order → /job-orders`). The table lives beside the data modules and each feature adds its row.
- **Everything on screen updates by itself, and four rules keep that cheap.** There is no refresh button and no "N changed" badge.
  1. **Only queries on screen refetch.** A query nobody is looking at is marked stale and costs nothing until its screen opens.
  2. **Work-center scope.** When an event names a work center and a matched query is about specific work centers, the query refetches only if they overlap. A job order starting on Injection 2 does not refetch Injection 4's tile.
  3. **One refetch per query per window.** The first event refetches at once; further events inside the next two seconds collapse into one refetch at the end of it. A burst of micro-stops is one request.
  4. **Expensive aggregates are never event-driven.** A query marked `meta: { realtime: false }` (OEE, production totals) ignores events and refetches on a timer, once a minute, only while its tab is visible.
- **Reconnect refetches everything on screen.** There is no replay, so anything may have been missed.
- **Live values do not use HTTP at all.** `tag.value.recorded` carries the value; counters and speeds on screen are updated from the socket.
- The connection state carries the time it began, for the design's "Offline since 10:31" chip and the Overview banner, and the client exposes `retryNow()` for the banner's button.
- **Auth errors are told apart.** `auth.unauthenticated` → the session ends (section 7). `auth.unavailable` → stay signed in and retry with backoff (Socket.io does not retry a middleware rejection by itself). A server-side disconnect → reconnect, and let the handshake decide.
- **`tag.value.recorded` is the one event that carries data.** It goes to a per-tag store read with `useSyncExternalStore`, not through the query cache. That store is built with the first screen that shows a live value.
- The web app subscribes to entity rooms (`job_order`, `user`) for the list on screen. The operator panel subscribes to `wc:<station>` and that work center's `tag:<id>` rooms.

**The operator panel is online-first, not offline-capable.** Three independent facts decide this:

1. Plain HTTP gives no secure context, so a service worker cannot be registered.
2. Scrap and adjustment POSTs are not idempotent, so replaying a queued write can double-count production.
3. The gateway has no replay, so a client that was offline cannot know what it missed.

What the panel does instead:

- A connection indicator (REST reachability and socket state) is always visible.
- Writes are disabled while disconnected, with the reason shown.
- A write whose response never arrived (timeout, dropped connection) is reported as **"result unknown"**. The panel refetches the list and shows what the server has; it never offers a blind retry of a non-idempotent write.
- Mutations are never retried automatically.

Offline entry becomes possible after backend changes B4 (idempotency keys) and B5 (TLS). It is a separate design.

## 9. UI system and design handoff

What the canvas fixes, and where it lands:

| In the design | In the code |
|---|---|
| The custom properties at the top of `edmes.css` (ink, surfaces, lines, text, accent, the four state tones with foreground and background, the three OEE factor colours, radius, three font stacks) | `@mes/ui/src/styles/theme.css`, the single token file. A change in the design is a change in this file and nowhere else. |
| Work-center states, each with a tone **and a shape**, "never color alone": running (play), unplanned stop (octagon), planned stop (pause), idle (ring). The canvas also draws a fifth, offline (cross); it is not built, see the table below. | One `StatePill` primitive in `@mes/ui` with four states. Both apps show machine state the same way. |
| Buttons (36 px, small 28 px), inputs, segmented control, tabs, chips, switch, dialog, popover, menus, banners, skeleton, empty state, avatar | Primitives in `@mes/ui`: Base UI behaviour, the design's look. |
| Grid tables with a column chooser, sort marks, row menus whose disabled items say why, pagination with 20 / 50 / 100 | A `DataTable` composite in `apps/web` on TanStack Table 9 (visibility, manual sorting and pagination). |
| Sidebar (six groups, collapsible to a 64 px rail) and top bar (connection chip, plant clock, user menu) | `apps/web/src/components/`, the web app's shell. |
| Loading per card ("figures never show 0 while loading"), empty, filtered-empty, page error with a reference, one failing part while the rest keeps working, no permission | One `PageState` family in `apps/web`. Every card owns its query and its error; a route loader never blocks a page on a card's data. |
| Six motion options for live values, to pick one | The lightest one ("live tip": only the leading end pulses), as a CSS animation of `opacity` and `transform`, off under `prefers-reduced-motion`. A wall display runs it all day. |
| English and Turkish, language switch on the login page | i18next resources per app; the pre-login choice is stored on the device. |

- **One component set, two densities.** The canvas defines the desktop density. `<html data-density="touch">` in the operator panel raises control height (56 px against 36 px), type size and spacing through the same variables. Touch targets are at least 48 px and nothing in the panel depends on hover. Until the panel has its own boards, its screens are built from the same tokens and primitives in touch density.
- Fonts (Barlow, Barlow Semi Condensed, IBM Plex Mono) are installed from npm and bundled; the canvas loads them from Google Fonts, the product cannot. No request leaves the factory network.
- Components that only one app needs (the numeric keypad, the sidebar) stay in that app until the other needs them.
- The canvas's "Optional concepts" page (OEE target, audit log, alerts, maintenance, quality, departments, configurable dashboards) is outside this design. Each would arrive as a feature folder, a data module and an invalidation row, with no change to the structure.
- Turkish terms are the services' own: scrap is "Hurda" and a reason is "sebep". The canvas's "Fire kayıtları" becomes "Hurda kayıtları" and its "Nedenler" becomes "Sebepler".

### Changes proposed to the design

The rule for a screen or a component: it stays if a user acts on it or decides from it, and it must be cheap to keep current. Measured against that:

| Board or component | Proposal | Why |
|---|---|---|
| Live floor and the wall display | Keep. The landing page is the Overview (section 7) | What a shift supervisor watches. One component, two layouts. |
| Overview: plant OEE with its three factors, work centers by state, open stops | Keep | Little data, and the open stops are acted on from there (assign a reason, close a stop). |
| Overview: the work-center table with shift bars and OEE per row | Keep, with two changes. At most eight rows, the ones needing attention first, and a link to Live floor for the rest. The bar moves from under the job order to under the work center's name, inside the Work center column, and shows that work center's state since the start of the shift. No column is added. | The table is useful and, once the read API exists, free: it reads the same cached per-work-center data as the Live floor tiles, through the same queries, so having both open costs one set of requests. The bar shows the work center's shift, not the job order; under the job order column it reads as a job order bar, where rows would span different periods and "idle" would make no sense. |
| Overview: the plant-wide produced / plan / forecast chart | Keep, with the plan line renamed "Expected so far" | Each row shows what its running job order has produced against what it should have produced by now, taken from the product standard (`idealOutputPerMinute` × planned time), not from the job order's target, which can span several shifts. The plant figure is the sum over the running job orders, and a percentage when their units differ. The forecast is the current pace carried to the end of the shift. The read API design defines the fields. |
| The "Offline / no data" work-center state | Remove | A work center without a job order is idle whatever its data does; one whose data stops while a job order runs falls behind its expected quantity in the same row. Connection problems belong to the Edge devices screen. Four states remain. |
| OEE by hour | Keep on the Overview and on OEE analysis | With `oee/series` the hours are cut from one loaded context and the result is cached for every viewer. |
| Columns "saved for your account" | Saved on the device | No backend support (B11). |
| Roles board | Add the two application switches and a "Duplicate role" action | Section 7. |
| Session expired board | Remove | Section 7. |
| Refresh button with a change count on lists | Remove | Section 8. |

## 10. Build, serve, deploy

- `apps/Dockerfile` builds both apps and copies them into one `nginx-unprivileged` image: `ghcr.io/ulasdnz/edmes-frontend:${EDMES_VERSION}`. Web app at `/`, operator panel at `/operator/`.
- nginx: SPA fallback per app, hashed assets cached immutable for a year, `index.html` and `version.json` never cached, CSP and `frame-ancestors 'none'`, `/healthz` for the healthcheck.
- Traefik: a `frontend` router on ``PathPrefix(`/`)`` with priority 1, so every API, `/socket.io` and `/uploads` rule wins. `/uploads` is added to the user router.
- The release matrix gains `frontend`; `scripts/package-release.sh` already bundles every `image:` in the Compose file, so air-gapped installs pick it up.
- **No runtime configuration.** URLs are relative to the origin and the timezone comes from `/users/me`. One image runs at every customer.
- **Version skew.** A tablet can run a bundle for days. Each build writes `version.json` and the apps poll it every five minutes. On a mismatch the web app offers a reload; the panel and the wall display reload by themselves when no dialog is open and no write is pending. A failed lazy-chunk load (`vite:preloadError`) reloads once.
- Development: `docker compose up -d` for the backend, then `pnpm --filter web-app dev` (port 5173) or `pnpm --filter operator-panel dev` (5174). Vite proxies `/api`, `/socket.io` and `/uploads` to `http://localhost`.

## 11. Testing

| Layer | Tool | What it proves |
|---|---|---|
| Domain, time, permission logic | Vitest, node | Business rules with exact values |
| HTTP client, session | Vitest, node, a real `node:http` server | Headers, envelope handling, the 401 / 503 / network state machine |
| Realtime client | Vitest, node, a real in-process Socket.io server | Room union, rejoin, refetch on reconnect, the two auth errors |
| Primitives and presentational components | Vitest browser mode (Chromium) | Rendering, keyboard and touch behaviour, target sizes |
| Screens with server data | Playwright against `docker compose up` | The real services, gateway, nginx and both apps together |

A component that needs server data is split into a container (hooks) and a presentational component (props). The presentational part gets browser tests; the container is covered end to end. No test fakes the backend below the E2E layer, and no config uses `passWithNoTests`. Playwright traces and `docker compose logs` are kept for every run, green or red.

## 12. Backend changes the frontends need

| # | Change | Needed for | When |
|---|---|---|---|
| B1 | `GET /users/me` returns `meta.permissions`; `@mes/privileges` gains `accessWebApp` and `accessOperatorPanel` and loses the 15 `access*Screen` codes; user-service creates the five ready-made roles | Any permission-aware UI | Foundation |
| B12 | The monitoring read API: one batched, sectioned endpoint for the live screens, cached OEE, hourly OEE series (`2026-11-25-monitoring-read-api-design.md`) | Live floor, wall display, Overview, OEE analysis, the operator station | After the foundation, before the Monitoring screens |
| B2 | Build-time OpenAPI emit per service; register each module's paths | Typed client | Foundation for user-service, then per feature |
| B3 | Traefik routes: frontend catch-all, `/uploads` | Serving the apps, avatars | Foundation |
| B4 | Idempotency key on `POST /scrap-entries` and `POST /quantity-adjustments` | Safe retry, any offline entry | Before the panel's scrap screen ships to a customer |
| B5 | TLS at the gateway | Service worker, wake lock, secure-context APIs | Before offline work |
| B6 | Decide what `mustChangePassword` means. The design has no password change ("Passwords are reset by an administrator"), and no endpoint exists, so a user flagged this way has nothing to do. | First login after a reset | With the profile screen |
| B7 | Token refresh or a longer-lived session, and logout | Sessions longer than a day, server-side sign-out. A wall display would otherwise need someone to sign in on the TV every day. | Open decision 1 |
| B8 | Operator quick login (PIN or badge) | Fast shift handover on shared tablets | Open decision 1 |
| B9 | Role names for the signed-in user (`/users/me` returns role ids) | The top bar's role line and the "Your roles (Planner) do not include…" message | Done with the Profile page: `GET /users/me?populate=roles` answers the caller's roles as `{ _id, name, description }`, without permissions and without `readRoles`; without `populate` the roles stay ids, which the session store reads |
| B10 | A public plant time and timezone (`GET /api/v1/auth/plant-time`, done with the web shell's canvas pass); the attempts left on a failed login; the lockout's remaining seconds as a field (today the number exists only inside the translated message) | The login page's "Plant time 10:42", "2 attempts left" and the live "Try again in 4:32" countdown | Plant time: done. The rest with the login page's polish |
| B13 | `GET /users` accepts `withoutWorkCenter=true` | The users page's subtitle "23 users · 21 active · 1 without any work center", three counting requests with `limit=1` | With the web shell's canvas pass |
| B11 | Per-user UI preferences | "Columns … are saved for your account" across devices | When a customer asks; the device-local store covers one device |

One observation to confirm rather than a finding: `POST /api/v1/auth/register` is public (`auth.routes.ts:13`). If a self-registered account can be activated or granted roles without an admin, it should not be reachable from the LAN.

## 13. Open decisions for the owner

Each has a default the foundation plan follows; changing one later is local to the part named.

1. **Operator identity.** Default: every operator is a user and signs in on the tablet with email and password, which works today and gives real `startedBy` attribution. Alternative: a kiosk account plus PIN or badge, which needs B7 and B8. Affects the panel's login screen only.
2. **TLS on site.** Default: version 1 runs on plain HTTP and uses no secure-context API. Affects whether offline can ever be offered.
3. **Tablet browser floor.** Default: Chromium 111 or newer (the Tailwind 4 floor; Safari 16.4, Firefox 128). Needs the tablets' OS and browser to confirm.
4. **One image or two.** Default: one `edmes-frontend` image. Two would allow separate hosts for the panel, which nothing needs yet.
5. **Contract source.** Default: OpenAPI, completed per module (B2). The alternative, hand-written types, is faster to start and drifts silently.
6. **Operator panel design.** The canvas has no panel boards. Default: the foundation builds the panel's structure in touch density from the same tokens, and its screens are designed before its feature plans.
Settled on 2026-11-25: Turkish terms follow the services ("Hurda" for scrap, "sebep" for reason; the canvas's "Fire" and "Nedenler" are replaced); lists update by themselves under the four rules of section 8; two application permissions and ready-made roles replace the screen codes; ECharts draws the charts; an expired session goes to the login page; there are four work-center states and no offline state; produced is shown against the quantity expected from the product standard.

## 14. Delivery order

1. **Foundation** (the plan beside this document): toolchain, three shared packages, both app shells signed in and live, image, routing, CI, E2E.
2. **The monitoring read API** (B12), a backend plan of its own. It can be built while the first web features are.
3. **Web app features**, one plan per sidebar group of the design, each starting with its modules' OpenAPI registration: System (users, roles, specialities, performance policy, profile), Master data, Production, Stops, Telemetry, then Monitoring last, because Live floor, Overview, OEE analysis, Timeline and Trends read from every other module and from the read API.
4. **Operator panel flows**, after its boards exist: check-in, job order start and end, scrap and adjustments, stops, live counters.
