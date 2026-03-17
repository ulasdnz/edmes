# Station-Service Specification

Decision-complete specification for a new on-prem MES `station-service`, following the same structural conventions as `user-service`.

## Summary

- `station-service` is a new service app at `station/`, using the same conventions as `user/`: Express 5, Mongoose 9, Zod 4, shared `@mes/*` packages, `/api/v1` and `/internal/v1`, Redis Streams, OpenAPI, health routes, and audit logging.
- It owns station master data, station hierarchy, schedules and shift overrides, operator check-in/check-out records, station tag bindings, station action-state snapshots, and station action-state history queries.
- It does not own raw tag values, time-series, job orders, downtime workflow, service workflow, or action detection logic. In this spec, `OEE` is a separate future upstream service that detects operational actions, and `tag-service` is a separate future upstream service that owns tag identity and current tag values.
- Public access requires both a station permission (e.g. `readStations`) and that the station is in the user's `stationIds`. Visible stations are exactly the user's `user-service.stationIds`. Internal routes follow the same system-bypass convention as `user-service`.

## Domain Model

Service modules: `station`, `schedule`, `operators`, and `state`.

### Station

`Station` is the core aggregate with these fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | ObjectId | |
| `name` | string | Globally unique |
| `description` | string? | Optional free-text for station notes or context |
| `parentStationId` | ObjectId? | Nullable — null means root station |
| `kind` | `leaf \| aggregate` | Mutable (see Lifecycle Transitions) |
| `metricSource` | `tag_driven \| derived` | Mutable (see Lifecycle Transitions) |
| `productivityMode` | `count_based \| speed_based` | `tag_driven` only |
| `status` | `active \| archived` | |
| `props` | `Map<string, string>` | Customer-specific metadata (e.g. SAP codes), same pattern as user model |
| `shiftIds` | `ObjectId[]` | References to shifts in external service (TBD) |

**Station types:**

- **Leaf station**: a physical machine with its own sensors and PLC signals. Always `tag_driven`. A leaf can be standalone (no parent) or belong to an aggregate (has `parentStationId`). A leaf can never have children.
- **Aggregate station**: a grouping that contains child stations — a production line, a factory area, or a reporting group. An aggregate is not a physical machine; it represents a collection of machines or other aggregates. An aggregate can itself be a child of another aggregate, enabling multi-level hierarchies. An aggregate can be `tag_driven` (when the line/group has its own physical sensors, e.g. a line-level output counter) or `derived` (metrics calculated from its children).

**Supported combinations:** `leaf + tag_driven`, `aggregate + derived`, `aggregate + tag_driven`. `leaf + derived` is out of scope.

**Hierarchy** is a single-parent tree via `parentStationId`. Only aggregate stations may have children. Two mechanisms exist for assigning children:

- **Direct assignment** (for `tag_driven` aggregates): update the child station's `parentStationId` directly via PATCH.
- **Composition-driven** (for `derived` aggregates): setting `metricComposition` automatically assigns contributors as children. Children of derived aggregates are managed exclusively through composition — direct `parentStationId` assignment to a derived aggregate is rejected.

The parent tree is for grouping and ownership. It does not model product flow or machine sequencing — that is a separate domain (job routing / process planning). `$graphLookup` is used internally for cycle checks and cascade operations.

```text
Example 1: standalone machine — no parent, independent

Press 01                         leaf + tag_driven
```

```text
Example 2: serial production line — aggregate groups its machines

Line 01                          aggregate + derived (metrics from children)
├── Cutter 01                    leaf + tag_driven
├── Welder 01                    leaf + tag_driven
└── Packer 01                    leaf + tag_driven
```

```text
Example 3: line with its own sensors — aggregate has both children and own tags

Extrusion Line 01                aggregate + tag_driven (line-level output counter)
├── Extruder 01                  leaf + tag_driven
└── Winder 01                    leaf + tag_driven
```

### Metric Composition

`metricComposition` applies only to `derived` stations. `tag_driven` stations use their own field tags and do not have metric composition config.

Derived metric configuration is explicit per metric family. Each family declares `contributors[]` and one calculation rule. Generic formula language is intentionally out of scope.

**Supported rules** (3 generic rules, same for all metric families):

| Rule | Contributors | Calculation |
|------|-------------|-------------|
| `primary_station` | Exactly 1 | Aggregate metric = that single contributor's metric |
| `average` | 2 or more | Arithmetic mean of contributors |
| `weighted` | 2 or more, each with `weight` (0–1) | Weighted sum. Sum of weights must equal 1.0 (±0.001 tolerance) |

`metricComposition` is optional at creation (can be configured later when contributor stations exist). Once set, all 3 metric families (`availability`, `productivity`, `quality`) must be provided together. Each family can have different contributors and a different rule.

```
metricComposition: {
  availability: { rule: 'weighted', contributors: [{ stationId, weight: 0.6 }, { stationId, weight: 0.4 }] },
  productivity: { rule: 'average', contributors: [{ stationId }, { stationId }] },
  quality: { rule: 'primary_station', contributors: [{ stationId }] }
}
```

### Schedule

- `StationCalendar` contains `validFrom`, `validTo`, `status: active|retired`, and `weeklyPattern`. `DateException` overrides one local date with explicit working intervals; an empty intervals array means the day is closed.
- Shift shape (defined in external service, also used for calendar/exception intervals): `{ name, startHour, startMinute, endHour, endMinute }`. Night shifts are supported: when `endHour < startHour`, the shift spans into the next day.
- `weeklyPattern` is day-based shift arrays: `{ monday: Shift[], tuesday: Shift[], ..., sunday: Shift[] }`.
- Schedule validity windows may not overlap for the same station. Date exceptions are unique per station and local date. Resolved working intervals may never overlap.
- Effective schedule resolution order: DateException > Calendar weeklyPattern > station's `shiftIds`. If the external shift service is unavailable when resolving `shiftIds`, the result is an empty array and a warning is logged. If no schedule is found at any level, the result is an empty array.

### Operator Check-In

- `OperatorCheckIn` tracks operator check-in/check-out history with `stationId`, `operatorId`, `checkedInAt`, `checkedOutAt?`, and optional `shiftId` (reference to the shift active at check-in time). `operatorId` is a user-service user's `_id`. Operator identity is validated against user-service on check-in.
- Duplicate active operator check-in for the same `stationId + operatorId` is forbidden. The same operator may have active check-ins on different stations simultaneously (by design — supports mobile operators and supervisory roles).
- Automatic operator check-out occurs only when an internal shift-ended event is received and the station is effectively scheduled for that shift window.

### Action State

- `StationActionState` is the station-owned action snapshot model with `stationId`, `changedAt`, and `activeActions: string[]`. It does not represent the machine's general runtime state. It represents only situations where action is required.
- `activeActions` is a simple string array of enum values: `['downtime', 'operator', 'jobOrder', 'service']`.
- The stored action state is a snapshot. Whenever the active action set changes for a station, a new snapshot record is written.
- Idempotency: incoming snapshots are compared with the last stored snapshot. If the `activeActions` set is identical, no new record is written. No key-based dedup is used.

## Station Configuration And Tags

- `tagBindings` are explicit fields, not a free-form property bag.
- `productivityMode` applies only to `tag_driven` stations and determines how production output is measured from the field:
  - `count_based`: for discrete manufacturing — a sensor counts individual items produced (parts, pieces, units). OEE performance is calculated from total count and ideal cycle time. Typical for stamping presses, injection moulding, CNC machining, assembly, and packaging.
  - `speed_based`: for continuous/process manufacturing — a sensor measures the production rate as a continuous value (meters/min, liters/hour, kg/hour). OEE performance is calculated by comparing actual speed to ideal speed. Typical for extrusion lines (cable, pipe, film) and paper production.
  - Derived stations do not have `productivityMode`.
- For tag-driven stations (leaf or aggregate), `productionCounterTagId` and `runModeTagId` are mandatory regardless of `productivityMode`.
- `speedTagId` is mandatory when `productivityMode=speed_based`.
- `attentionSignalTagId` is optional and applies only to `tag_driven` stations. If present, station-service will mirror whether the station currently has any active action. Derived stations do not have `attentionSignalTagId` — OEE action detection depends on `runModeTagId`, which only `tag_driven` stations have.
- `productionCounterTagId` is the field tag that reports produced quantity.
- `runModeTagId` is the field tag that tells whether the machine is currently running or not running.
- These tags are field signals read from PLCs by Fledge and persisted by `tag-service`. Station-service stores only tag identifiers, not raw values or time-series.
- Aggregate stations may also have tag bindings when the line has its own field signals.
- `actionSettings` include:
  - `jobOrderMissingThresholdMs`
  - `operatorMissingThresholdMs`
  - `uncausedDowntimeThresholdMs`
  - `downtimeConfirmationDeadlineMs`
  - `serviceOverrunThresholdMs`
- `actionSettings` are valid only when `attentionSignalTagId` is configured. If `attentionSignalTagId` is absent, these settings are hidden in UI and writes for them are rejected by the API.
- `microStopThresholdMs` is an optional field for `tag_driven` stations. Stoppages shorter than this duration are ignored in OEE calculations (treated as noise, not real downtime). Defaults to 0 (all stoppages count). Station-service stores this value; OEE consumes it.

## Hierarchy Operations

Hierarchy is a single-parent tree via `parentStationId`. There are two distinct ways `parentStationId` changes: **user-driven move** (explicit PATCH by a user) and **backend-driven orphaning** (automatic side-effect of another operation). Different validation rules apply to each.

### User-Driven Move

A move is a user-initiated change to a station's `parentStationId` via PATCH. Before executing, the following pre-checks are evaluated in order — the move is rejected if any fail:

| # | Pre-check | Reason |
|---|-----------|--------|
| 1 | Station is a contributor in any station's `metricComposition` | Remove from composition first |
| 2 | New parent is a derived aggregate | Derived aggregate children are managed exclusively through composition |
| 3 | New parent is a leaf station | Leaf stations cannot have children |
| 4 | New parent is archived | Parent must be active |
| 5 | New parent is the station itself | Creates a cycle |
| 6 | New parent is a descendant of this station | Creates a cycle |

If all pre-checks pass, the move is valid:

| Station type | Old parent | New parent | Side-effects |
|-------------|-----------|-----------|--------------|
| Leaf | null (root) | tag_driven aggregate | — |
| Leaf | tag_driven aggregate | different tag_driven aggregate | — |
| Leaf | tag_driven aggregate | null (make root) | — |
| Aggregate (±children) | null (root) | tag_driven aggregate | Children stay with the station |
| Aggregate (±children) | tag_driven aggregate | different tag_driven aggregate | Children stay with the station |
| Aggregate (±children) | tag_driven aggregate | null (make root) | Children stay with the station |

A successful move emits `station.hierarchy.changed`. No additional side effects on move (no schedule inheritance change, no cascade updates).

Note: a station whose old parent is a derived aggregate is always a contributor in that aggregate's composition — pre-check #1 catches this case.

### Backend-Driven Orphaning

Orphaning is when the backend sets a station's `parentStationId` to `null` as a side-effect of another operation. No user-driven move validations apply — the backend performs these automatically.

| Trigger | Affected stations | Additional side-effects | Event per orphaned child |
|---------|------------------|------------------------|--------------------------|
| Archive of aggregate | All children of the archived station | Derived aggregates: `metricComposition` also cleared | `station.updated` |
| Composition update (contributor removed from all families) | Removed contributors | — | `station.updated` |
| MetricSource `tag_driven → derived` | Existing children not referenced in new composition | — | `station.updated` |
| Hard delete of aggregate | All children of the deleted station | — | `station.updated` |

In all cases, orphaned children are NOT auto-archived — they become root stations.

### Composition-Driven Child Assignment

When `metricComposition` is set or updated, the backend automatically manages child relationships within a MongoDB transaction.

**Contributor validations** (reject if any fail):

| # | Validation |
|---|-----------|
| 1 | Contributor station must exist |
| 2 | Contributor station must be active |
| 3 | Contributor must not have a current parent (unless already this station's child) |
| 4 | Contributor must not be a contributor in another station's composition |
| 5 | Contributor must not be an ancestor of this station (cycle prevention) |

**Side-effects on composition set/update:**

| What changed | Side-effect |
|-------------|-------------|
| New contributor added (in any family) | Contributor's `parentStationId` → this station, `station.updated` emitted |
| Contributor removed from ALL families | Contributor's `parentStationId` → null (orphaned), `station.updated` emitted |
| Contributor still in at least one family | No change to `parentStationId` |

A composition change emits `station.metric_composition.changed`.

## Lifecycle Transitions

### Status Transitions

Station status is `active | archived`. Archiving is **reversible**. State diagram: `active ↔ archived → (hard delete if eligible)`. Archived stations remain visible and queryable.

| From | To | Validations | Side-effects | Events |
|------|-----|------------|-------------|--------|
| active | archived | No open operator check-ins; station is not a contributor in any station's `metricComposition` | Aggregate: orphan all children. Derived aggregate: also clear `metricComposition` (must be reconfigured after reactivation) | `station.archived` + `station.updated` per orphaned child |
| archived | active | — | No automatic restoration of previously cleared `metricComposition` or orphaned children. Composition must be reconfigured separately | `station.reactivated` |
| active | hard delete | No inbound composition references; no active calendars; no open operator check-ins; no action-state history; no `user-service` stationIds references | Orphan children if any. Closed operator check-in records remain as orphaned references | `station.deleted` + `station.updated` per orphaned child |

Hard delete blockers must be resolved manually before retrying. If hard delete is not possible, archive is always available (subject to its own validations).

### Kind Transitions

| From | To | Validations | Notes |
|------|-----|------------|-------|
| leaf | aggregate | — | Station can now have children |
| aggregate | leaf | Station must have no children | — |

### MetricSource Transitions

| From | To | Validations | Side-effects | Fields cleared | Fields required |
|------|-----|------------|-------------|---------------|----------------|
| tag_driven | derived | `metricComposition` must be provided | Existing children not referenced in new composition are orphaned | `tagBindings`, `productivityMode`, `microStopThresholdMs`, `attentionSignalTagId`, `actionSettings` | `metricComposition` |
| derived | tag_driven | `tagBindings` and `productivityMode` must be provided | Children remain (now managed via direct `parentStationId` assignment) | `metricComposition` | `tagBindings`, `productivityMode` |

## Action State Semantics

- Action state does not mean `running`, `stopped`, or any other general machine status.
- Action state means station-specific situations where someone or some process must do something.
- OEE detects these situations. Station-service only stores, updates, and exposes them.
- `downtime` means a relevant downtime-related follow-up is still missing according to OEE rules.
- `operator` means the machine appears to be running, but no active operator check-in exists and the configured operator threshold has been exceeded.
- `jobOrder` means the machine appears to be running, but no active job order exists and the configured job-order threshold has been exceeded.
- `service` means a configured service threshold has been exceeded according to OEE rules.
- Multiple action types may be active for the same station at the same time. The stored snapshot may contain one or many active actions.
- `attentionSignalTagId` receives only one aggregated numeric value through `tag-service`:
  - `1` when at least one action is active for the station.
  - `0` when no action is active for the station.
  - The action type itself is never written to the tag.
- OEE runs a dedicated worker/script for `jobOrder` and `operator` action generation. That worker pulls job-order data, reads operator check-in/check-out records from station-service, keeps supporting data warm through Redis Streams, and re-evaluates conditions on a fixed interval.
- That evaluation applies only to stations that have `attentionSignalTagId`.
- For `jobOrder` and `operator`, OEE checks only while `runModeTagId` currently indicates that the machine is running.
- If the machine appears to be running, there is no active job order, and `jobOrderMissingThresholdMs` has elapsed, the next action snapshot includes `jobOrder`.
- If the machine appears to be running, there is no active operator check-in, and `operatorMissingThresholdMs` has elapsed, the next action snapshot includes `operator`.
- `downtime` and `service` are also detected upstream in OEE. Station-service does not own downtime workflow, service workflow, or separate downtime/speed-loss case APIs.
- When station-service accepts an internal action-state write request for a station that has `attentionSignalTagId`, it persists the snapshot and mirrors the aggregated `0/1` attention signal through `tag-service`. If `tag-service` is unavailable, the snapshot is still persisted and the tag write failure is logged — the same fire-and-forget pattern used for event publication. Initial implementation: tag-service is stub, mirroring is a no-op.

## Visibility

- Visible stations are exactly the stations listed in the user's `stationIds` in user-service. No automatic descendant or ancestor inheritance.
- When a new station is created, the creator's `stationIds` in user-service is updated via a **synchronous internal API call** to user-service (not an event). If user-service is unavailable, the failure is logged — the creator can manually add the station to their visibility.

## Permissions

Module-based CRUD privileges:

| Module | Permissions |
|--------|-------------|
| Station | `readStations`, `writeStations`, `deleteStations` |
| Schedule | `readSchedules`, `writeSchedules` |
| Operators | `readOperators`, `writeOperators` |
| Action State | `readActionState` |

- Action state writes are restricted to internal API only (from OEE). No public write permission exists by design.

## Commands And Queries

- Station mutations use standard REST verbs: **create** (POST), **replace** (PUT — full body), **update** (PATCH — partial body), **delete** (DELETE). No separate routes for archive, reactivate, move, metric composition, or config. The backend detects which fields changed and applies the correct validation and side effects:
  - `status` changed → see Status Transitions table.
  - `parentStationId` changed → see User-Driven Move table.
  - `kind` changed → see Kind Transitions table.
  - `metricSource` changed → see MetricSource Transitions table.
  - `metricComposition` changed → see Composition-Driven Child Assignment table.
  - `tagBindings` / `actionSettings` changed: validate dependencies (e.g. `actionSettings` requires `attentionSignalTagId`).
- Calendar mutations follow the same REST pattern: **create** (POST), **replace** (PUT), **update** (PATCH), **delete** (DELETE). No separate routes for activate/retire — `status` change is a field update via PATCH, backend validates (e.g. overlapping validity windows).
- Date exception: **upsert** (PUT by station + local date), **delete** (DELETE).
- Operator check-in records: **create** (POST — check-in), **update** (PATCH — check-out sets `checkedOutAt`). Query endpoints for active and historical check-ins.
- Internal authenticated commands: handle shift-ended event and ingest action-state snapshots from OEE.
- Public queries: get station (includes tagBindings, actionSettings, metricComposition), list stations (flat list filtered by user's stationIds), resolve effective schedule for a date or range, list active operator check-ins, list operator check-in history, get latest action-state snapshot, and query action-state history by time range.
- Internal queries: existence/basic context by station id, station lookup for other services, and latest action-state snapshot lookup without external auth. Canonical station events are always published by `station-service` on `events.station`.

## Cross-Cutting Rules

- All multi-document hierarchy operations (composition updates, archive cascades, metricSource changes, hard delete cascades) execute within a **MongoDB transaction**.
- **Write operations require active station**: calendar creation, operator check-in, and other station-scoped writes are rejected if the target station is archived.
- Weighted metric composition: sum of contributor weights validated with **±0.001 tolerance** (accommodates floating-point arithmetic).
- Event publication follows current monorepo convention: persist first, then publish canonical domain events. Publication failure does not roll back the write, but it is logged and auditable.
- External ids and tag ids are validated before commit when their owner service is available. User/operator ids come from `user-service`; tag ids come from `tag-service`.
- Action-state logic is disabled for stations that do not have `attentionSignalTagId`.
- Historical station action-state snapshots are stored durably in MongoDB, queryable by time range, and must survive restart. No in-memory-only state is authoritative.
- All mutable aggregates use the shared audit log plugin.

## Events

- Publish on `events.station`: `station.created`, `station.updated`, `station.archived`, `station.reactivated`, `station.deleted`, `station.hierarchy.changed`, `station.metric_composition.changed`, `station.schedule.changed`, `station.operator.checked_in`, `station.operator.checked_out`, and `station.action_state.changed`.
- `station.hierarchy.changed` is emitted on user-driven moves. `station.updated` is emitted for each child whose `parentStationId` changes as a backend-driven side-effect (orphaning).
- Every emitted event includes `eventId`, `type`, `occurredAt`, `traceId`, and relevant station/runtime ids.
- Event payload schemas must be defined before implementation but are not included inline in this spec.

## External Dependencies

- Depend on `user-service` for operator validation, visibility roots, and delete dependency checks.
- Depend on `tag-service` for station tag identity validation and for mirroring `attentionSignalTagId` as `0/1` when action-state snapshots change.
- Depend on an external service (name TBD) for shift definitions referenced by `shiftIds`.
- Accept internal action-state write requests from OEE and internal shift-ended events from their owning services. OEE keeps ownership of detection and workflow logic.
- **Initial implementation**: `tag-service` is stub — tag ID fields are accepted but not validated, attention signal mirroring does nothing (the code path exists but skips the actual write to tag-service). OEE is stub — the internal action-state API is implemented but unused until OEE ships. Shift service is stub — `shiftIds` are accepted but not validated. When each real service comes online, the stub implementation is replaced with the real client. Stub code is marked with `TODO` comments for easy discovery.

## Acceptance Scenarios

Scenarios below cover behaviors not fully captured by the tables above.

**Station creation:**
- Creating a tag-driven station without `productionCounterTagId` or `runModeTagId` is rejected.
- Creating a speed-based tag-driven station without `speedTagId` is rejected.
- Creating an aggregate + derived station without `metricComposition` is allowed (configured later when contributor stations exist).
- Saving `actionSettings` for a station that does not have `attentionSignalTagId` is rejected.

**Schedule:**
- An effective schedule for a date uses date exception first, then active calendar weekly pattern, then station's `shiftIds`, with no overlap. No schedule at any level returns an empty array.

**Operator check-in:**
- Checking the same operator into the same station twice while the first check-in is still open is rejected.
- Receiving a shift-ended event auto-checks-out only those open operator check-ins whose station is scheduled for that shift.

**Action state:**
- When OEE sends an action-state snapshot for a station with `attentionSignalTagId`, station-service persists the snapshot and mirrors `1` through `tag-service` if any action is active, otherwise `0`.
- If the machine appears to be running, no active job order exists, and `jobOrderMissingThresholdMs` has elapsed, the next action snapshot includes `jobOrder`.
- If the machine appears to be running, no active operator check-in exists, and `operatorMissingThresholdMs` has elapsed, the next action snapshot includes `operator`.
- Querying station action-state history by time range after a restart returns the same persisted records.

**Visibility:**
- A user with `readStations` sees only stations explicitly in their `stationIds`, regardless of hierarchy position.

## Assumptions

- Single factory timezone from deployment config; no per-station timezone.
- Departments/business hierarchy are owned by a separate future service and are out of this spec.
- OEE is a separate future service in the target architecture; this spec defines how station-service will integrate with it once that service exists.
- `tag-service` is a separate future service in the target architecture; this spec defines which tag identifiers and tag mirroring behavior station-service will depend on once that service exists.
- No separate pre-aggregated reporting cube; action-state history queries are computed from durable station action-state records.
- Hierarchy depth has no explicit limit.
