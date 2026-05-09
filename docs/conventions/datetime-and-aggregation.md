# DateTime & Aggregation Convention

How instant timestamps, date-only values, range queries, and aggregation are handled across the monorepo. Apply these rules in every new service and PR. Background and concrete findings live in:

- [`docs/audits/timezone-date-audit.md`](../audits/timezone-date-audit.md)
- [`docs/audits/performance-telemetry-contract-audit.md`](../audits/performance-telemetry-contract-audit.md)

---

## Wire format & storage

- **Boundary (HTTP, MQTT, Redis Streams events):** all instant timestamps are UTC ISO-8601 with a trailing `Z`. Example: `2026-05-08T10:30:00.000Z`.
- **Database (MongoDB):** instants are stored as native `Date`. Never as ISO strings.
- **Conversion:** validation transforms input strings to `Date` once at the boundary. Service code never calls `new Date(req.query.x)` or `new Date(req.body.x)` directly.

## Backend validation

- Every instant input passes through `utcDateSchema` from `@mes/core` (or `utcDateTimeStringSchema` if a `Date` transform is not wanted).
- Offset-less datetimes (`2026-05-08T10:30:00`), space-separated (`2026-05-08 10:30:00`), browser `Date.toString()`, and date-only strings as instants are rejected with HTTP 400 and i18n key `validation.datetime_utc_z_required`.
- Controllers consume already-transformed values; manual `new Date()` cast is forbidden.

## Date-only fields

A date-only value (e.g. `birthDate`, future `productionDate`, `occurrenceDay`) is **not** an instant. It is modelled as a `String` matching `^\d{4}-\d{2}-\d{2}$` with calendar-validity round-trip refine. Example: `user.birthDate` in `user/src/modules/user/user.validators.ts`.

```ts
const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'validation.birth_date_format' })
  .refine(v => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && v === d.toISOString().slice(0, 10)
  }, { message: 'validation.birth_date_invalid' })
```

Mongoose schema mirrors with `type: String, match: /^\d{4}-\d{2}-\d{2}$/`. Never use `Date` for a date-only concept — server-timezone-dependent off-by-one bugs follow.

## Range queries — half-open `[from, to)`

Every date-range query uses **half-open** semantics: `from` inclusive, `to` exclusive.

```ts
collection.find({ occurredAt: { $gte: from, $lt: to } })
```

Reasons: adjacent windows tile without overlap, no millisecond precision games (`23:59:59.999` etc.), shift/day boundary samples are not double-counted.

A `to`-inclusive sample belongs to the next window's response, not this one. New endpoints accepting a range document this in their JSDoc/OpenAPI description.

## Aggregation & timezone

A scalar window summary (single value or fixed-size object per caller-supplied UTC window) does **not** take a `timezone` argument:

```ts
// scalar — no timezone
{ $match: { occurredAt: { $gte: from, $lt: to } } }
{ $group: { _id: null, count: { $sum: 1 } } }
```

Calendar-grouping aggregation (per-day, per-hour-aligned-to-day, per-shift) **must** pass `timezone: plantTz` to the relevant operator. Without it, buckets are UTC and a non-UTC plant gets off-by-one rollups:

```ts
{ $group: {
    _id: { $dateTrunc: { date: '$occurredAt', unit: 'day', timezone: plantTz } },
    qty: { $sum: '$count' },
} }
```

Same rule for `$dateToString`, `$dateAdd`, `$dateSubtract`, `$dateDiff`, `$dayOfMonth`, `$year`, etc. — when the intent is plant-local, `timezone` is required.

`PLANT_TIMEZONE` is read from service config (Zod-validated IANA string, fail-fast on boot). Currently consumed by `work-center` for shift logic and `user` for exposing runtime plant context to authenticated frontends; other services declare it only when they need it.

## Cross-service: scalar/summary contract

Cross-service calls return **scalar summaries**, never raw sample arrays. The boundary rule:

> OEE/KPI formulas in Node are fine; raw tag-sample aggregation in Node is not.

Telemetry exposes summary/scalar endpoints (`produced-summary`, `speed-summary`, `latest`) returning fixed-size objects per caller-supplied window. Performance composes scalars (multiplications, ratios). A change that pulls `/tag-values` raw arrays into another service is rejected.

If a consumer needs a new aggregate, the producer adds a new summary endpoint — the consumer does not stream and aggregate locally.

## PLANT_TIMEZONE & runtime config

- `PLANT_TIMEZONE` is a **runtime** config value, set per deployment (installer/operator).
- Frontend bundles **must not** embed `VITE_PLANT_TIMEZONE` or any other deployment-specific env. The bundle is environment-agnostic; one CI build deploys to N customers.
- Frontend reads `plantTimezone` and `serverTime` from `GET /api/v1/users/me` response metadata after auth.
- Browser local timezone is never the source of truth for plant-local time.

## Helpers — YAGNI

A shared helper goes into `@mes/core` only when there are **2+ real consumers** or a clear cross-service need. A single in-service usage stays local. Example: `birthDateSchema` lives in `user.validators.ts` (one consumer); if `productionDate` or `occurrenceDay` arrives, the schema is promoted then.

`utcDateSchema`/`utcDateTimeStringSchema` are in `@mes/core` because every service exposes datetime boundaries — that meets the bar.

---

## Quick checklist for new code

1. New API field carrying an instant → `utcDateSchema` validator, no manual cast.
2. New date-only field → `String` with regex + round-trip refine, **not** `Date`.
3. New range query → `$gte: from, $lt: to`. Document `[from, to)` in the endpoint description.
4. New aggregation that buckets by day/hour/shift → pass `timezone: plantTz`.
5. New cross-service call → returns a fixed-size summary object, not a stream/array of samples.
6. New env var that varies per customer → backend env (Zod-validated), exposed via API; never frontend bundle env.
