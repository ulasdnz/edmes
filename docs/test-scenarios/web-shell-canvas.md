# Test Scenarios: web-shell-canvas

> Generated: 2026-11-26 | Spec: docs/superpowers/specs/2026-11-25-dual-frontend-architecture-design.md (sections 7, 9, 12: B10, B13) | Design: "Edmes Web App" canvas boards Sidebar, Topbar, SignIn, Users, States
> Status: READY
> Immutable after implementation starts.
>    To change: update this file, then re-run /write-scenario-tests.

Scope: the web app's shell brought in line with the canvas: the logo, the sign-in page's brand panel and plant time, the users page's Active pills and subtitle, the Turkish offline wording, "Copy error details". The Profile page and its menu item are not in scope (they wait for the owner's answers on avatar removal and the gender options). The Overview start-page rule is in the spec only; there is no Overview yet.

---

## AuthPlantTime.public
> target: user/src/modules/user/__tests__/user.routes.test.ts

### happy path
- `GET /api/v1/auth/plant-time` with no `Authorization` header → 200, `data.plantTimezone` equals `config.PLANT_TIMEZONE`, `data.serverTime` is an ISO 8601 UTC instant ending in `Z` within 5 s of the test's own clock

### constraints
- [CRITICAL] the answer carries exactly the keys `plantTimezone` and `serverTime` under `data`, nothing about any user or the configuration
- an invalid or expired Bearer token on the same request → still 200 (the endpoint does not look at the token)

---

## OpenApiDocument.plantTime
> target: user/src/lib/openapi/document.test.ts

### constraints
- the user-service document has `GET /auth/plant-time` with `security: []` and a 200 schema of `data.plantTimezone` and `data.serverTime` (strings)
- `/users` `get` lists the query parameter `withoutWorkCenter`

---

## UsersList.withoutWorkCenter
> target: user/src/modules/user/__tests__/user.routes.test.ts

### happy path
- two users with `workCenterIds: []` and one with one work center, `GET /api/v1/users?withoutWorkCenter=true` → only the two, `pagination.total` 2

### boundaries
- `withoutWorkCenter=false` or absent → no filter, all three counted
- `withoutWorkCenter=true&isActivated=true` with one of the two deactivated → only the active one without a work center

### edge cases
- `withoutWorkCenter=yes` → 400 with the validation envelope

### authorization
- [CRITICAL] a caller without `readUsers` → 403 `auth.insufficient_permissions`, as for the list without the filter

---

## Web.brand
> target: apps/web/src/components/app-sidebar.browser.test.tsx

### happy path
- the expanded sidebar shows the logo mark and the EDMES wordmark (`img` with `alt="EDMES"`), and the pair links to `/`
- the collapsed rail shows the mark alone, as a link to `/` whose accessible name is "EDMES"

### constraints
- both images come from files bundled with the app (their `src` is not an absolute URL and no request leaves the origin)

---

## Web.signInBrand
> target: apps/web/src/features/auth/login-page.browser.test.tsx

### happy path
- the sign-in page shows the brand panel: logo mark, EDMES wordmark, the line "Plan and follow production, keep stops explained and read OEE for the work centers assigned to you." and "Runs on this factory network · no internet connection needed"
- with `GET /auth/plant-time` answering `plantTimezone: 'Europe/Istanbul'`, `serverTime: '2026-11-23T07:42:00.000Z'` → "Plant time 10:42 · Europe/Istanbul"; in Turkish "Tesis saati 10:42 · Europe/Istanbul"

### edge cases
- the device clock is 2 hours behind the server → the plant time still reads 10:42 (server time, not the device's)
- `GET /auth/plant-time` fails (network or 503) → the plant time line is left out and the sign-in form works as before
- the minute advances while the page is open → the plant time follows it without a reload

---

## Web.usersActivePill
> target: apps/web/src/features/users/users-table.browser.test.tsx

### happy path
- an active user's Active cell shows a status pill "Active" with a check mark; an inactive user's shows "Inactive" with a cross (Turkish "Etkin" / "Etkin değil", the words the app already uses)

### constraints
- the two pills differ by mark and by colour, not colour alone (the mark is an icon inside the pill)

---

## Web.usersSubtitle
> target: apps/web/src/features/users/users-page.browser.test.tsx

### happy path
- counts 23 total, 21 active, 1 without a work center → the subtitle reads "23 users · 21 active · 1 without any work center"; in Turkish "23 kullanıcı · 21 etkin · 1 iş merkezi olmayan"

### boundaries
- 0 without a work center → that part is left out: "23 users · 21 active"
- 1 user, 1 active → "1 user · 1 active" (singular)

### edge cases
- the counts are still loading → the subtitle shows a skeleton, never a 0
- the count requests fail → the subtitle is left out and the table still shows
- the counts do not change with the search box or the page: they count every user

---

## Web.usersCountsQuery
> target: packages/frontend/src/data/user/users.test.ts

### happy path
- the counts read `GET /users?limit=1`, `GET /users?limit=1&isActivated=true` and `GET /users?limit=1&withoutWorkCenter=true` and take each `pagination.total`

### constraints
- their query keys start with `['get', '/users', …]`, so a `user.*` realtime event refetches them like the list

---

## Web.offlineWording
> target: packages/frontend/src/i18n/resolve-language.test.ts

### happy path
- English: "Offline since 10:31"
- Turkish: "10:31’den beri çevrimdışı" (typographic apostrophe)

### boundaries
- Turkish suffix follows the spoken last number of the time: `10:30` → "10:30’dan", `10:40` → "10:40’tan", `10:23` → "10:23’ten", `10:36` → "10:36’dan", `10:05` → "10:05’ten", `10:09` → "10:09’dan", `10:20` → "10:20’den", `10:50` → "10:50’den", `10:00` → "10:00’dan" (read as "on"), `09:00` → "09:00’dan" (dokuz), `03:00` → "03:00’ten" (üç), `00:00` → "00:00’dan" (sıfır)

---

## Web.copyErrorDetails
> target: apps/web/src/components/page-state.browser.test.tsx

### happy path
- the page error shows "Copy error details" next to "Try again"; pressing it copies a text with the error code, the HTTP status, the trace id and the time in plant time, and the button says "Copied" for a moment

### edge cases
- [HIGH] no secure context, as on the plant's plain-HTTP address (`navigator.clipboard` is missing or refuses) → the text is copied through a selected, hidden text area and the button says "Copied"
- both the clipboard and that fallback refuse → the details stay selectable on screen and the button says "Copy failed"
- an error without a trace id → the copied text says "trace id: none"

---

## E2E.webShellCanvas
> target: apps/ui-e2e/src/web-auth.spec.ts

### happy path
- the sign-in page on the stack shows "Plant time HH:mm · <the stack's PLANT_TIMEZONE>", where HH:mm is the plant time of the server
- the users page subtitle on the stack equals the counts the API answers for the three count requests

### constraints
- [HIGH] the sign-in page asks `GET /api/v1/auth/plant-time` without a token and no other API before sign-in
