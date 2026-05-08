# Performance → Telemetry Contract Audit

**Date:** 2026-05-08
**Scope:** HTTP calls performance makes to telemetry; response shapes; OEE hot-path payload risk; interval semantics; calendar-grouping timezone.

---

## 1. Endpoint Inventory

| # | Caller file:line | Method | Path | Params | Trigger |
|---|---|---|---|---|---|
| 1 | `performance/src/lib/internal-api/telemetry.client.ts:87` | GET | `/internal/v1/historian/:tagId/latest` | none | `run-mode.reconciler.ts:87` (boot, no cursor); `run-mode.processor.ts:125` (debounce-tick) |
| 2 | `performance/src/lib/internal-api/telemetry.client.ts:95–99` | GET | `/internal/v1/historian/:tagId/state-durations` | `?from=<ISO>&to=<ISO>` | `run-mode.reconciler.ts:68` (boot, cursor present) |
| 3 | `performance/src/lib/internal-api/telemetry.client.ts:112–118` | POST | `/internal/v1/historian/:tagId/produced-summary` | body `{ windows:[{from,to}…] }` | `oee.service.ts:367` (stage 5, productivity); `oee.service.ts:413` (stage 6, quality, `net_run_segments` only) |
| 4 | `performance/src/lib/internal-api/telemetry.client.ts:132–138` | POST | `/internal/v1/historian/:tagId/speed-summary` | body `{ windows:[{from,to}…] }` | `oee.service.ts:370` (stage 5); `oee.service.ts:415` (stage 6, `net_run_segments` only) |

No calls to public historian routes (`/samples`, `/series`, `/compact-values`, `/rollup`, `/stats`, `/produced`, `/speed-avg`) appear anywhere in `performance/src/`.

---

## 2. Response Shape per Endpoint

**Endpoint 1 — GET `/latest`**
Handler: `historian.controller.ts:74–77` → `historian.service.ts:348–359`
Response: `{ data: { tagId: string, value: number, occurredAt: Date } | null }`
Classification: Single scalar object. O(1). Not a stream.

**Endpoint 2 — GET `/state-durations`**
Handler: `historian.controller.ts:68–72` → `historian.service.ts:340–346` → `binary.calc.ts:calculateStateDurations`
Response: `{ data: StateSegment[] }` where `StateSegment = { state, start, end, durationMs }`.
Classification: Variable-length array. Length scales with state-transition count in the window. **This is a segment array crossing the service boundary — not a fixed-size summary.**

**Endpoint 3 — POST `/produced-summary`**
Handler: `historian.internal.routes.ts:8–13` → `historian.controller.ts:79–83` → `counter.calc.ts:calculateProducedMulti`
Response: `{ data: { windows: ProducedWindowResult[], total: number } }` — `windows.length` equals the number of windows sent in the request body (caller-controlled, schema max 500).
Classification: Fixed-size summary. O(N_job_orders), not O(samples).

**Endpoint 4 — POST `/speed-summary`**
Handler: `historian.internal.routes.ts:15–21` → `historian.controller.ts:85–89` → `speed.calc.ts:calculateSpeedAvgMulti`
Response: `{ data: { windows: SpeedWindowResult[], total: {durationMs, timeWeightedAverage, valueArea} } }` — same sizing guarantee as endpoint 3.
Classification: Fixed-size summary. O(N_job_orders), not O(samples).

---

## 3. Payload Size Analysis (Hot Path)

Endpoints 3 and 4 are the only OEE hot-path calls. Endpoints 1 and 2 are on the run-mode boot-reconcile path only.

| Endpoint | Size driver | Worst-case estimate |
|---|---|---|
| produced-summary (stages 5 & 6) | One `ProducedWindowResult` (~80 B) per job-order window | 500 windows (schema max) × 80 B ≈ 40 KB. Typical shift: 1–10 job orders < 1 KB |
| speed-summary (stages 5 & 6) | One `SpeedWindowResult` (~120 B) per window | Same bound |

Neither response scales with raw sample count. The DB fetch inside telemetry (`counter.calc.ts:106–108`, `speed.calc.ts:118–120`) does pull all raw samples into memory server-side, but **only the computed scalar summary crosses the HTTP boundary. The scalar/summary contract is upheld on the OEE hot path.**

**Endpoint 2 boot-path risk:** `getStateDurations` window is `[cursor, now)`. After an 8-hour outage with a 1 Hz tag: up to ~28,800 segments × ~64 B ≈ 1.8 MB per work center. Allocated simultaneously in telemetry (full `.toArray()` in `binary.calc.ts:28–29`) and performance (full `StateDurationSegment[]` response). Not a steady-state OEE risk, but a cold-boot memory spike proportional to outage duration × work-center count.

---

## 4. Half-Open vs Closed Interval Usage

**`binary.calc.ts:22–29` (serves endpoint 2)**

```
baseline:  { occurredAt: { $lt:  rangeStart } }   // open — correct
in-window: { occurredAt: { $gte: rangeStart, $lte: rangeEnd } }   // CLOSED [from, to]
```

Closed on both ends. A sample exactly at `rangeEnd` is included in this window's response. The current sole consumer (the run-mode reconciler) does not tile adjacent windows, so right-boundary overlap has not produced a bug — but a future tiling caller (e.g. hourly bucketing) would double-count any boundary sample. The reconciler does have a skip guard at `run-mode.reconciler.ts:72` (`if (occurredAt <= cursor) continue`); that guard exists for a separate, intentional concern — cursor-based deduplication on the **left** boundary (cursor is the last-processed sample timestamp, `$gte` returns it, the guard skips it as already-handled). The right-boundary closed-interval issue is independent of that guard and is addressed in the P1 finding in Section 6.

**`counter.calc.ts:101–108` (serves endpoint 3)**

```
baseline:  { occurredAt: { $lt:  overallFrom } }   // open — correct
in-window: { occurredAt: { $gte: overallFrom, $lte: overallTo } }   // CLOSED [from, to]
```

In-memory window partition uses `firstIndexAfter` which implements strictly-greater-than `> from`, giving effective per-window semantics of `(from, to]`. Mismatch: DB fetch is `[$gte]` but in-memory left boundary is `(>`. The sample at `overallFrom` is fetched but excluded from all computed windows (it only serves as a potential baseline). Not a correctness bug, but an over-fetch and inconsistent semantics.

**`speed.calc.ts:113–120` (serves endpoint 4)**

```
baseline:  { occurredAt: { $lt:  overallFrom } }   // open — correct
in-window: { occurredAt: { $gte: overallFrom, $lte: overallTo } }   // CLOSED [from, to]
```

In-memory partition uses `lowerBoundByTime` (first doc `>= from`), giving `[from, to]` per window — unlike counter's `(from, to]`. A sample exactly at `overallFrom` participates in the first window's trapezoidal integration as well as potentially being the baseline. The boundary treatment differs from counter without documentation.

**`oee.repository.ts:46–54, 94–99` (performance-local, not a cross-service call)**

Planned stop overlap query: `plannedStartAt: { $lt: to }` and `actualEndAt: { $gt: from }` — open on both sides, correct.
Unplanned stop overlap query: `startAt: { $lt: to }` and `endAt: { $gt: from }` — open on both sides, correct.

---

## 5. Calendar-Grouping + Timezone Parameter Status

No performance→telemetry call requests bucketed/grouped data by calendar interval. The two summary endpoints accept caller-defined UTC window pairs and return one aggregate per window. Calendar bucketing is the caller's responsibility. No timezone parameter is needed or passed.

**no findings.**

---

## 6. Findings

### P0

No P0 findings. The OEE compute path uses only fixed-size summary objects. No raw sample array crosses the service boundary on any OEE hot path.

---

### P1

```
[P1] performance/src/modules/run-mode/run-mode.reconciler.ts:68 — getStateDurations returns a variable-length StateSegment[] array across the service boundary on the boot-reconcile path
  Risk: After an extended outage (e.g. 8-hour maintenance window at 1 Hz tag frequency), telemetry returns up to ~28,800 segments × ~64 B ≈ 1.8 MB per work center, allocated simultaneously on both sides. With many monitored work centers, cold-boot memory spikes proportional to outage_duration × monitored_wc_count. The endpoint also uses a closed right-interval ($lte: rangeEnd in binary.calc.ts:28); the reconciler has an implicit guard at line 72 to prevent double-processing the boundary, but this coupling is undocumented.
  Minimal fix: Expose a dedicated scalar endpoint /internal/v1/historian/:tagId/latest-at?t=<ISO> that returns the state value at a single instant, which is the reconciler's actual data requirement. If full segment replay is needed, add server-side pagination or a hard cap (e.g. last 1,000 segments).

[P1] telemetry/src/modules/historian/calculations/binary.calc.ts:28 — closed right-side interval $lte: rangeEnd causes adjacent windows to overlap on their shared boundary
  Risk: A sample with occurredAt === rangeEnd is included in this window's response and would also be included in the next window [rangeEnd, ...] if a caller tiled them. State transitions on a window boundary would be double-counted by any tiling caller. The current sole consumer (run-mode reconciler) does not tile, so this has not surfaced, but the closed right side diverges from the half-open [from, to) convention adopted elsewhere.
  Minimal fix: Change binary.calc.ts:28 to { occurredAt: { $gte: rangeStart, $lt: rangeEnd } } (half-open [from, to)). Leave the skip guard at run-mode.reconciler.ts:72 in place — it serves a separate, left-boundary deduplication concern: the reconciler calls getStateDurations(cursor, now) where cursor is the last-processed sample timestamp; with $gte, that sample comes back and must be skipped as already-processed. Do NOT change the left side ($gte) of the in-window query — it is generic-function semantics that future callers may rely on for "include the sample at rangeStart."
  Required edge tests before merging: (a) sample at exactly rangeEnd is excluded from the response; (b) the same sample becomes the in-window head of the next [rangeEnd, ...) call; (c) reconciler does not re-process the sample at cursor across reboots; (d) reconciler processes a transition immediately after cursor; (e) two adjacent windows' durations sum equals the total duration with no double-count; (f) idempotency: two consecutive reconciler boots with the same cursor process zero new transitions.
```

---

### P2

```
[P2] performance/src/lib/internal-api/telemetry.client.ts:86–99 — getLatest and getStateDurations co-located with OEE summary functions in the same client file
  Risk: A developer adding OEE data requirements may reach for getStateDurations believing it is an approved OEE data source, violating the scalar/summary contract. The current co-location provides no structural signal that these two functions serve a different concern (run-mode state machine, not OEE computation).
  Minimal fix: Move getLatest and getStateDurations into a dedicated run-mode-telemetry.client.ts in performance/src/modules/run-mode/ (or performance/src/lib/internal-api/run-mode-telemetry.client.ts).

[P2] telemetry/src/modules/historian/calculations/counter.calc.ts:107 and speed.calc.ts:119 — DB fetch uses closed $gte/$lte while in-memory partitioning uses differing per-window semantics; undocumented
  Risk: Counter uses (from, to] in-memory (via firstIndexAfter); speed uses [from, to] (via lowerBoundByTime/upperBoundByTime). DB fetch in both is [$gte, $lte]. The differing per-window semantics are deliberate (counter is delta math; speed is area-integral) but undocumented, and a future contributor could "optimize" the DB fetch to $gt and silently break correctness.
  Minimal fix: Add JSDoc to each calculator explaining (a) the per-window semantics it uses and why it differs from the project-wide [from, to) range-query convention, (b) that the closed [$gte, $lte] DB fetch is deliberate because the sample at exactly overallFrom is needed as a window baseline (counter) or as the integral's opening point (speed). Add regression tests asserting the closed filter shape and the boundary-sample behavior. Do NOT change the DB filter to $gt — both an earlier version of this audit's "minimal fix" and a casual reading would suggest doing so, but it would drop the overallFrom sample from baseline/integral resolution and produce wrong deltas/averages.

[P2] telemetry/src/modules/historian/historian.routes.ts:72–78 — /state-durations and /latest are on the public requirePermission('readHistorian') router, not the internal router
  Risk: historian.internal.routes.ts registers only produced-summary and speed-summary. The two endpoints consumed by performance's run-mode path are exposed on the public router behind user auth (requirePermission('readHistorian')). There is no audit trail separating internal-service calls from end-user calls for these routes. Traefik routing changes could inadvertently apply rate limiting or user-scoped auth to internal callers.
  Minimal fix: Add GET /historian/:tagId/latest and GET /historian/:tagId/state-durations to historian.internal.routes.ts (mounted at /internal/v1/) and remove them from the public router, consistent with how produced-summary and speed-summary are handled.
```

---

## Summary

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 2 |
| P2 | 3 |

---

## Resolved

**2026-05-08 — Half-open right interval for `getStateDurations`**

The second P1 finding (closed `$lte: rangeEnd` in `binary.calc.ts:28`) is fixed. The in-window query is now `{ occurredAt: { $gte: rangeStart, $lt: rangeEnd } }` — half-open `[from, to)`. The endpoint contract for `GET /internal/v1/historian/:tagId/state-durations` is therefore `[from, to)`: the `to` instant is exclusive. A sample with `occurredAt === to` belongs to the next window, not this one.

Tests added/strengthened:
- `binary.calc.test.ts` — filter assertion (`$lt`, not `$lte`); filter-aware tiling test that asserts boundary sample appears only in the second adjacent window's docs.
- `run-mode.reconciler.test.ts` — idempotency test: two consecutive boots with the same segment data do not double-create stops.

The reconciler skip guard at `run-mode.reconciler.ts:72` was **left in place** — it serves left-boundary cursor deduplication, which is a separate concern from right-boundary tiling.

Still open: the first P1 (boot-path payload size of `getStateDurations` after extended outages) and all three P2s (client co-location, counter/speed boundary inconsistency, public-vs-internal router placement).
