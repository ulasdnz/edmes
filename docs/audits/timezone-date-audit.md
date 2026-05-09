# Timezone & Date-Handling Audit

**Date:** 2026-05-08
**Scope:** All services in the monorepo — user, work-center, production, performance, telemetry, realtime
**Standard:** UTC ISO-8601 with trailing `Z` at all API/event/MQTT boundaries; `Date` in MongoDB; `utcDateSchema` / `utcDateTimeStringSchema` from `@mes/core` for all instant validators

---

## Section 1 — Boundary Enforcement

| Validator file | Fields | Uses utcDateSchema? |
|---|---|---|
| `production/src/modules/job-order/job-order.validators.ts` | `plannedStartAt`, `dueAt`, `startTime`, `endTime`, `activeFrom`, `activeTo`, range filters | YES |
| `production/src/modules/production-plan/production-plan.validators.ts` | `dueAt`, range filters | YES |
| `production/src/modules/scrap-entry/scrap-entry.validators.ts` | `startTime`, `endTime`, range filters | YES |
| `production/src/modules/quantity-adjustment/quantity-adjustment.validators.ts` | `time`, range filters | YES |
| `production/src/modules/internal/job-order-records-batch.validators.ts` | `from`, `to` per item | YES |
| `performance/src/modules/planned-stop/planned-stop.validators.ts` | `plannedStartAt`, `plannedEndAt`, `actualStartAt`, `actualEndAt`, `from`, `to` | YES |
| `performance/src/modules/unplanned-stop/unplanned-stop.validators.ts` | `startAt`, `endAt`, `approvedAt`, `from`, `to` | YES |
| `performance/src/modules/oee/oee.validators.ts` | `from`, `to` | PARTIAL — UTC-Z check only, no `.transform()` |
| `telemetry/src/modules/historian/historian.validators.ts` | `from`, `to` | YES |
| `telemetry/src/modules/tag/tag-value.validators.ts` | `time` | YES |
| `work-center/src/modules/schedule/schedule.validators.ts` | `validFrom`, `validTo` | YES |
| `telemetry/src/modules/ingestion/ingestion.pipeline.ts` | MQTT `msg.time` | YES — `parseUtcZonedDateTime()` from `@mes/core`, drops on invalid |

Redis Streams event payloads carry only IDs + `traceId` per architecture — no instant timestamps in event payloads, so no boundary surface there.

---

## Section 2 — Negative Validator Search

- `performance/src/modules/oee/oee.validators.ts:4-11` — local `utcInstantSchema` defined inline (string + endsWith-Z + Date.parse). Functionally equivalent to `utcDateTimeStringSchema` from `@mes/core/src/time.ts`, but lacks the `.transform(value => new Date(value))` step.
- `user/src/modules/user/user.validators.ts:70` — `birthDate: z.coerce.date().optional()`. `z.coerce.date()` accepts offset-less datetimes (`"1990-05-15T08:00:00"`) and date-only strings (`"1990-05-15"`).

No occurrences of `z.string().datetime()`, `z.date()`, or `z.iso.datetime()` in source.

---

## Section 3 — Mongoose Date Field Map

**user-service**

| Field | Write validator | Status |
|---|---|---|
| `User.birthDate` | `z.coerce.date()` (`user.validators.ts:70`) | FLAGGED — see Section 2 |
| `User.lastFailedLoginAt` | server `new Date()` only | OK |
| `User.passwordChangedAt` | server-internal | OK |

**work-center**

| Field | Write validator | Status |
|---|---|---|
| `Calendar.validFrom`, `Calendar.validTo` | `utcDateSchema` (`schedule.validators.ts:25-26`) | OK |
| `Operators.checkedInAt`, `checkedOutAt` | server-internal | OK |

**production**

| Field | Write validator | Status |
|---|---|---|
| `JobOrder.plannedStartAt`, `dueAt`, `startTime`, `endTime` | `utcDateSchema` | OK |
| `ScrapEntry.startTime`, `endTime` | `utcDateSchema` | OK |
| `QuantityAdjustment.time` | `utcDateSchema` | OK |
| `ProductionPlan.dueAt` | `utcDateSchema` | OK |
| `ProductStandard.validFrom` | `utcDateSchema` | OK |

**performance**

| Field | Write validator | Status |
|---|---|---|
| `PlannedStop.plannedStartAt`, `plannedEndAt`, `actualStartAt`, `actualEndAt` | `utcDateSchema` | OK |
| `UnplannedStop.startAt`, `endAt`, `approvedAt` | `utcDateSchema` | OK |
| `RunModeProcessingState.lastProcessedOccurredAt` | server-internal (downstream of validated `occurredAt`) | OK |

**telemetry**

| Field | Write validator | Status |
|---|---|---|
| `tag_samples_*.occurredAt` | `parseUtcZonedDateTime(msg.time)` in ingestion pipeline | OK |

---

## Section 4 — Silent Coercion Paths

- `performance/src/modules/oee/oee.controller.ts:12-13` — `new Date(from)` / `new Date(to)` on strings validated by `oeeQuerySchema` (UTC-Z only, no transform). Safe today because the validator enforces trailing `Z` upstream, but the structural divergence from the `utcDateSchema` transform pattern is a hazard if the schema is ever reused or relaxed.

No other unvalidated `new Date(req.body.*)` or `Model.set(field, value)` patterns found in service code.

---

## Section 5 — Date-Only Mismodeling

- `user/src/modules/user/user.model.ts` `User.birthDate` is `type: Date` but is conceptually a date-only value. Combined with `z.coerce.date()`, an offset-less input like `"1990-05-15T08:00:00"` is parsed in **server local time**, producing a different UTC instant on UTC+3 vs UTC+0. Off-by-one-day risk on display/comparison.

`Calendar.validFrom`/`validTo` and `ProductStandard.validFrom` use UTC-midnight anchors (`T00:00:00.000Z`) consistently and are gated by `utcDateSchema`. Internally consistent — not flagged.

---

## Section 6 — Aggregation Timezone Parameter

No `$dateToString`, `$dateTrunc`, `$dateAdd`, `$dateSubtract`, `$dateDiff`, `$dayOfYear`, `$dayOfMonth`, `$dayOfWeek`, `$year`, `$month`, `$week`, `$hour`, or `$minute` operators found anywhere in source.

Telemetry historian `getSeries` / `getRollup` use millisecond epoch arithmetic only (`$toLong`, `$subtract`, `$mod`, `$floor`, `$multiply`) — pure UTC, no calendar bucketing.

**no findings.**

---

## Section 7 — PLANT_TIMEZONE Drift

- **Defined and consumed:** `work-center` only — `work-center/src/config/index.ts:52-65` validates an IANA tz; consumed in `shift.service.ts`, `shift.scheduler.ts`, `shift.reconciliation.ts`, and the `planned-stop-schedule` recurrence boundary helpers.
- **Injected but unused:** `docker-compose.yml:173` injects `PLANT_TIMEZONE=${PLANT_TIMEZONE:-Europe/Istanbul}` into the **telemetry** container, but `telemetry/src/config/index.ts` has no `PLANT_TIMEZONE` field — silently dropped at config parse.
- **Not present:** production, performance, realtime configs (no current need).

---

## Section 8 — Telemetry MQTT Timestamp Source (current behavior)

- **Edge payload includes a timestamp:** Yes. `IncomingMessage { time: string; value: number }` in `telemetry/src/modules/ingestion/ingestion.pipeline.ts:12`.
- **Parsing/validation:** `parseUtcZonedDateTime(msg.time)` (line 48) — enforces UTC-Z regex + `Date.parse`. Returns `null` and the message is dropped when invalid (line 49).
- **Server-receive timestamp:** Not used. No `Date.now()` or `new Date()` is applied to incoming samples; the edge-provided `time` is the sole timestamp written to `tag_samples.occurredAt`.
- **Both?** No — edge timestamp only.
- **Clock-skew mitigation:** None. There is a predecessor/out-of-order check (line 78) that drops samples older than the last seen value, but no maximum-delta check and no future-timestamp rejection.

---

## Section 9 — Production + Performance Plant-Local Queries

All date filters in production and performance accept explicit UTC instant boundaries (`utcDateSchema`) and run range queries against UTC `Date` fields. No "today" / "this shift" / `createdAt`-grouped daily-bucket queries exist; no `$group` by day/hour exists (consistent with Section 6).

The OEE endpoint accepts caller-supplied `from`/`to` UTC instants — converting plant-local shift boundaries to UTC is the caller's responsibility, which matches the architecture.

**no findings.**

---

## Findings

### P0

no findings.

---

### P1

```
[P1] performance/src/modules/oee/oee.controller.ts:12-13 — new Date(from) / new Date(to) on validated-but-not-transformed query strings; bypasses the @mes/core utcDateSchema transform pattern
  Risk: If the validator is ever relaxed or middleware ordering changes, offset-less strings reach new Date() and Mongoose stores server-local-time instants silently. Structural divergence from the shared pattern.
  Minimal fix: Switch oeeQuerySchema to utcDateSchema (transforms to Date) and drop the explicit new Date() casts.

[P1] performance/src/modules/oee/oee.validators.ts:4-11 — inline utcInstantSchema duplicates utcDateTimeStringSchema from @mes/core; lacks .transform() so callers must call new Date() manually
  Risk: Duplication is a maintenance hazard and forces every consumer to remember the manual cast. Drift between this local copy and the shared validator could silently change semantics on one side.
  Minimal fix: Replace utcInstantSchema with utcDateSchema from @mes/core; remove the inline definition.

[P1] user/src/modules/user/user.validators.ts:70 — birthDate uses z.coerce.date(), which accepts offset-less datetimes ("1990-05-15T08:00:00") and date-only strings ("1990-05-15")
  Risk: On a non-UTC server (e.g. UTC+3), an offset-less datetime is parsed in local time, so the stored UTC instant differs by the offset. Off-by-one date on display, especially around midnight.
  Minimal fix: Treat birthDate as date-only — validate with z.string().regex(/^\d{4}-\d{2}-\d{2}$/) and store as a String, or explicitly construct new Date(`${value}T00:00:00.000Z`) in the controller.
```

---

### P2

```
[P2] docker-compose.yml:173 — PLANT_TIMEZONE injected into the telemetry container but telemetry/src/config/index.ts has no PLANT_TIMEZONE field; the env var is silently ignored
  Risk: No runtime impact today. A future telemetry feature that assumes config.PLANT_TIMEZONE exists will read undefined without an error at startup.
  Minimal fix: Either remove the PLANT_TIMEZONE entry from the telemetry service env block in docker-compose.yml, or — only if a consuming feature is being added — declare it in telemetry's config Zod schema.
```

---

## Resolved

**2026-05-09**

- OEE query validation now reuses `utcDateSchema`; controller-level `new Date(from/to)` casts were removed.
- `birthDate` is now a date-only `YYYY-MM-DD` string with validator/model coverage.
- The unused telemetry `PLANT_TIMEZONE` compose injection was removed.
- `user` now validates `PLANT_TIMEZONE` and exposes `{ plantTimezone, serverTime }` in `GET /api/v1/users/me` response metadata for frontend runtime context.
