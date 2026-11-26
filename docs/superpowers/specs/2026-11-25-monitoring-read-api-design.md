# Monitoring Read API — Design

**Date:** 2026-11-25
**Status:** Proposed, awaiting owner review. No plan is written yet.
**Related:** `2026-11-25-dual-frontend-architecture-design.md` (backend change B12). The frontend foundation plan does not depend on this document; the Monitoring screens and the operator station do.

## 1. Problem

The live screens show the same few facts for every work center: its state, the running job order, produced against target, open stops, who is checked in, and the shift's OEE. Today each of those is a separate call per work center, and the expensive one is not cached.

What the code does now:

| Fact | Source |
|---|---|
| One `GET /oee` runs four stages of parallel reads: the work center, the policy, the non-OEE reasons, the started job orders and the stops; then product standard timelines and job order records; then the produced or speed summary and the known reasons; then a produced or speed summary per job order. About a dozen reads, most of them HTTP calls to other services. | `performance/src/modules/oee/oee.service.ts:232-440` |
| Nothing in the OEE module is cached. Two viewers asking for the same work center and range calculate twice. | `performance/src/modules/oee/` (no cache call) |
| A virtual work center calculates every contributor. | `oee.service.ts:95-98`, `virtual-work-center.ts` |
| OEE takes one work center and a `from`/`to`. There is no batch form, no named range and no hourly breakdown. | `oee.validators.ts` |
| The gateway serves plain HTTP/1.1, so a browser opens at most six requests to it at a time. | `docker-compose.yml:21-63` |

What that means for a Live floor of 10 work centers, as the design draws it: one OEE request per tile (each about a dozen reads), plus per-tile requests for the job order, stops, operators and produced quantity, repeated every minute by every open screen and wall display, queued six at a time. None of this is measured yet; the first task of the plan measures it (section 8).

## 2. Goals and non-goals

Goals:

- One request returns what a live screen needs for many work centers.
- The server computes only the parts a screen asks for.
- Reads that are the same for every work center in a request happen once.
- OEE is calculated at most once per work center and range per 30 seconds, however many screens ask.
- One failing part does not fail the response.
- Every value says when it was true.
- The cost of every request is logged, so the gain is a number.

Non-goals:

- Pushing these payloads through the realtime gateway. Events stay ID-only, as `CLAUDE.md` requires; a client refetches the affected work center.
- A background job that recalculates everything on a timer. Section 5 says why.
- ETag support. Event-driven refetches of small payloads gain little from it.
- A new service. The performance service already holds the clients and the OEE calculation.
- Reporting over long periods.

## 3. Endpoints

### 3.1 `GET /api/v1/monitoring/work-centers`

| Query | Meaning | Default |
|---|---|---|
| `workCenterIds` | Comma-separated ids. Ids the caller cannot see are left out of the answer, like the 404 a single read gives. | Every work center the caller can see |
| `include` | Comma-separated sections: `state`, `shift`, `job`, `production`, `stops`, `operators`, `oee`, `timeline` | `state,job` |
| `range` | The period for `production` and `oee`: `currentShift`, `today`, `last24h` | `currentShift` |

The server resolves a named range, so the client's clock plays no part and the cache key is the same for every viewer.

A screen names the sections it shows; the API does not know screens. A Live floor tile asks for `state,job,production,oee,operators`, the operator station for `state,shift,job,production,stops`, a refetch after an event for `state,job,stops`.

```json
{
  "data": [
    {
      "workCenterId": "665f1c2e9b1e8a0012a4c001",
      "code": "INJ-02",
      "name": "Injection 2",
      "state": { "value": "unplanned_stop", "since": "2026-11-23T07:28:00.000Z", "asOf": "2026-11-23T07:42:11.000Z" },
      "shift": { "shiftId": "665f1c2e9b1e8a0012a4d010", "name": "Morning", "startedAt": "2026-11-23T03:00:00.000Z", "endsAt": "2026-11-23T11:00:00.000Z" },
      "job": { "jobOrderId": "665f1c2e9b1e8a0012a4e120", "code": "JO-1043", "productId": "665f1c2e9b1e8a0012a4b002", "productCode": "P-1002", "productName": "Cap 38 mm blue", "uom": "pcs", "targetQuantity": 16000, "startTime": "2026-11-23T04:10:00.000Z" },
      "production": { "produced": 9120, "expected": 10400, "plannedSeconds": 12480, "scrap": 140, "adjustments": -20, "good": 8960, "asOf": "2026-11-23T07:42:00.000Z" },
      "stops": {
        "unplanned": { "unplannedStopId": "665f1c2e9b1e8a0012a4f300", "reasonId": null, "source": "run_mode", "startAt": "2026-11-23T07:28:00.000Z" },
        "planned": null
      },
      "operators": [{ "operatorId": "665f1c2e9b1e8a0012a4a777", "checkedInAt": "2026-11-23T03:02:00.000Z" }],
      "oee": null,
      "errors": [{ "section": "oee", "code": "monitoring.section_unavailable" }]
    }
  ],
  "meta": { "range": { "name": "currentShift" }, "serverTime": "2026-11-23T07:42:11.000Z" }
}
```

- A section that was not asked for is absent. A section that was asked for and failed is `null`, with an entry in `errors`. A section that has nothing to show (`job` on an idle work center) is `null` with no error.
- Instants are ISO 8601 UTC with `Z`, durations are seconds, quantities are raw numbers. Formatting belongs to the client.
- `good` is `produced − scrap + adjustments`, calculated here, so the rule has one home for every client.
- `expected` is what the running job order should have produced by now: the `idealOutputPerMinute` of the product standard valid for its product and work center, times `plannedSeconds / 60`. `plannedSeconds` is the job order's time inside the range with planned stops taken out; unplanned stops stay in, so a stopped machine falls behind. Both come from the standard and the planned-time rule the OEE productivity factor already uses, so they cost no read of their own. `expected` is `null` when no standard is valid. The job order's `targetQuantity` is not a shift target (a job order can run for several shifts) and is not used for this.
- `timeline` is the work center's state over the range, as segments in time order: `[{ "kind": "running" | "unplanned_stop" | "planned_stop" | "idle", "from": "…Z", "to": "…Z", "reasonId": "…" | null, "jobOrderId": "…" | null }]`. `idle` means no job order was running. It is built from the job order windows and the stops the OEE context already loads, so asking for `oee,timeline` reads them once. This is the Overview's per-row shift bar; every row covers the same range, so the bars share one time axis.

Error codes of a section: `monitoring.section_unavailable` (a dependency did not answer), `auth.insufficient_permissions` (the caller lacks the section's read permission), `monitoring.no_context` (the section needs something that does not exist, such as a shift for `range=currentShift`).

Permission per section, checked against the caller's permissions:

| Section | Needs |
|---|---|
| `state`, `stops` | `readUnplannedStops` and `readPlannedStops` |
| `shift` | `readSchedules` |
| `job` | `readJobOrders` |
| `production` | `readJobOrders` and `readProductionAdjustments` |
| `operators` | `readOperators` |
| `oee` | `readOee` |
| `timeline` | `readJobOrders`, `readUnplannedStops` and `readPlannedStops` |

### 3.2 `GET /api/v1/oee/series`

`?workCenterId=…&from=…&to=…&interval=1h` returns one OEE result per bucket. The context of section 4 is loaded once for the whole range and the buckets are cut from it in memory, so a shift's hourly chart costs about one calculation, not eight. Only the OEE analysis screen uses it.

### 3.3 `GET /api/v1/oee` (existing)

Keeps its contract and gains the cache of section 5 and the optional `range` name in place of `from`/`to`.

## 4. How a request is computed

1. **Scope.** The caller's visible work centers are intersected with `workCenterIds`.
2. **Context, once per request.** Work centers and their tag bindings, the policy, the non-OEE reason ids and the active shift of each work center are resolved once and handed to every section. Today each OEE calculation fetches the first three by itself.
3. **Sections, in parallel, each batched across work centers.** One query for the running job orders of all requested work centers, one for their open stops, one for their active planned stops, one for their check-ins. The number of reads for `state`, `job`, `stops` and `operators` does not grow with the number of work centers.
4. **Isolation.** A section that throws becomes `null` plus an error entry and a `warn` log. The others are returned.
5. **OEE.** `calculateOee` is changed to accept the preloaded context, then called per work center through the cache.

State is derived in this order: an active planned stop → `planned_stop`; else an open unplanned stop → `unplanned_stop`; else a running job order → `running`; else `idle`. There are four states and no fifth.

- `idle` means no job order has been started on the work center, whether or not pending ones are waiting for it.
- There is no "offline / no data" state (owner, 2026-11-25). A work center without a job order is idle whatever its data does, and one whose data stops while a job order runs falls behind `expected` in its row. An edge device's connection state belongs to the Edge devices screen: telemetry already stores it from the device's MQTT status topic (`telemetry/src/core/loaders/index.ts:66`).
- A planned and an unplanned stop are not meant to be open together (owner, 2026-11-25). If records do overlap, the planned stop wins, the same rule the OEE interval normalizer applies (`performance/src/modules/oee/interval-normalizer.ts`).

## 5. Caching

| Data | Lifetime | Invalidated by |
|---|---|---|
| Work centers and tag bindings, reasons, policy, product names | 5 minutes | The `work_center.*`, `reason.*`, `policy.updated` and `product.*` events the service already consumes or publishes |
| Active shift of a work center | Until the shift's end | `work_center.shift.started`, `work_center.shift.ended`, `work_center.schedule.changed` |
| State, running job order, open stops, check-ins | Not cached | They are single indexed reads, and they must be current right after the event that changed them |
| Produced quantity of the running job order | 10 seconds | Expiry |
| OEE and timeline for a named range | 30 seconds | Expiry |
| OEE for a closed `from`/`to` | 60 seconds | Expiry |

- **OEE is calculated on demand, not on a timer.** A timer would recalculate every work center all day whether or not anyone is looking, and on an on-premises server that is the cost we are trying to remove. With cache-aside and `singleflight` from `@mes/cache`, ten screens asking at once cause one calculation, and an idle factory floor causes none. If the first request after an idle period proves too slow on a wall display, a warm-up for watched work centers can be added later; it is not built now.
- For a named range, `to` is "now" rounded down to the 30-second boundary, so every viewer in that window shares one key.
- A virtual work center is assembled from its contributors' cached results.
- Keys live in the service's Redis under its prefix, with a version segment (`oee:v1:…`) so a change in the calculation never reads old entries.

## 6. How the screens use it

This is the server half of the four refresh rules in the frontend design.

- **First load:** one request for all tiles.
- **An event for one work center** (a job order starts, a stop opens, an operator checks in): the client asks again for that work center's cheap sections only, `?workCenterIds=X&include=state,job,stops`. That is three indexed reads on the server.
- **`production` and `oee`:** on a timer, once a minute while the tab is visible, never because of an event.
- **Counters and speeds between two polls:** from `tag.value.recorded` on the socket, no request.

**Produced against expected.** A row shows `produced` and `expected` of its running job order, in the product's unit. The Overview's plant figure is the client's sum of both over the rows that have a running job order; no endpoint returns it. When those rows do not share one `uom` the sum means nothing, so the figure becomes a percentage: each row's `produced ÷ expected`, weighted by its `plannedSeconds`. The forecast line is the current pace carried to the end of the shift, drawn by the client.

The Overview's work-center table and the Live floor's tiles ask for the same sections of the same work centers, so they share the client's cached queries and the server's cached results: opening one after the other, or both at once, costs one set of requests.

In the frontend data module each tile owns a query for its work center, and requests issued in the same tick are merged into one HTTP call. Tiles stay independent (one can fail or refetch alone) and the first paint is still a single request.

## 7. Observability

Every request logs one line, `event: 'monitoring.read'`, with the sections asked for, the number of work centers, the number of downstream calls, the cache hits and misses, and the duration of each section. OEE calculations log `event: 'oee.calculated'` with their stage durations and whether the result came from the cache. These lines are how section 8 is checked and how a slow site is diagnosed later.

## 8. Acceptance: measured, not assumed

The plan's first task records today's cost before anything changes, on seeded data for 10 and for 50 work centers with a shift of realistic stops and job orders: downstream calls and duration for one OEE request, for one virtual work center, and for everything a 10-tile Live floor asks in one refresh.

Then the plan must show, with the same data:

| Check | Expectation |
|---|---|
| Downstream calls for `include=state,job,stops,operators` | The same number for 1, 10 and 50 work centers |
| OEE calculations when 10 clients ask for the same 10 work centers within 30 seconds | 10, not 100 |
| OEE calculations while nobody asks | 0 |
| A dependency of one section is stopped | HTTP 200, that section `null` with its error, the others present |
| `oee/series` for an 8-hour shift at `1h` | The context is loaded once |

Duration budgets are set from the recorded baseline, not invented here.

## 9. Open questions

1. **Batch forms of three internal reads.** `findStartedJobOrders` takes one work center; check-ins are read per work center; the active shift is resolved per work center. Each needs a form that takes a list, in production and in work-center.
2. **Operator names.** `operators` returns ids. Names live in user-service; either this endpoint resolves them through a cached lookup or the client does through `/users`. The first keeps the tile to one request.
3. **`today` and `last24h`.** Whether both are needed beside `currentShift` is decided with the Overview's final design.

Settled on 2026-11-25: there is no offline state; planned and unplanned stops do not overlap; `expected` comes from the product standard (sections 3.1, 4 and 6); there is no OEE target, the target is a production quantity, so the OEE card shows no target.

## 10. Testing

- Unit tests per section loader against a real MongoDB (testcontainers), including the derivation order of `state` and the `null`-with-error path.
- Contract tests for the new batch internal reads, beside the existing `__contract__` tests.
- End-to-end in `e2e/` with the real services: the scenarios of section 8, plus the visibility rule (a work center the caller cannot see is absent) and the per-section permission rule.
- The cache is tested with real Redis: two concurrent requests calculate once; a request after expiry calculates again.
