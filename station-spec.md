# Station-Service Specification

Decision-complete specification for a new on-prem MES `station-service`, following the same structural conventions as `user-service`.

## Summary

- `station-service` is a new service app at `station/`, using the same conventions as `user/`: Express 5, Mongoose 9, Zod 4, shared `@mes/*` packages, `/api/v1` and `/internal/v1`, Redis Streams, OpenAPI, health routes, and audit logging.
- It owns station master data, station hierarchy, schedules and shift overrides, operator check-in/check-out records, station tag bindings, station action-state snapshots, and station action-state history queries.
- It does not own raw tag values, time-series, job orders, downtime workflow, service workflow, action detection logic, or ideal cycle time / ideal speed parameters (future product-station model in job order service).
- `OEE` is a separate future upstream service that detects operational actions. `tag-service` is a separate future upstream service that owns tag identity and current tag values.
- Public access requires both a station permission (e.g. `readStations`) and that the station is in the user's `stationIds`. Internal routes follow the same system-bypass convention as `user-service`.

## Domain Model

Service modules: `station`, `schedule`, `operators`, and `state`.

### Station

`Station` is the core aggregate. It has a single immutable `type` field:

- **Physical**: a real machine with sensors and PLC signals. Has tag bindings, productivity mode, operator check-in, and action state. Cannot have children.
- **Virtual**: a grouping (production line, factory area, reporting group). Derives metrics from other stations via `metricComposition`. Can have children. No tags, no operator check-in, no action state.

If a production line has its own physical sensors, that sensor is modeled as a separate physical station.

| Field | Type | Applies to | Notes |
|-------|------|-----------|-------|
| `code` | string | both | Globally unique, stable identifier for SAP/SCADA/PLC (e.g. `"CNC-01"`) |
| `name` | string | both | Globally unique display name |
| `description` | string? | both | Optional |
| `parentStationId` | ObjectId? | both | Organizational grouping only. null = root |
| `type` | `physical \| virtual` | both | **Immutable** |
| `status` | `active \| archived` | both | |
| `props` | `Map<string, string>` | both | Customer-specific metadata |
| `shiftIds` | `ObjectId[]` | both | External shift refs (TBD) |
| `productivityMode` | `count_based \| speed_based` | physical | How output is measured |
| `tagBindings` | object | physical | `productionCounterTagId` (mandatory), `runModeTagId` (mandatory), `speedTagId` (mandatory when speed_based) |
| `attentionSignalTagId` | ObjectId? | physical | Optional. Mirrors `0/1` action signal to tag-service |
| `actionSettings` | object? | physical | Only when `attentionSignalTagId` is set |
| `microStopThresholdMs` | number? | physical | Default 0. OEE consumes it |
| `metricComposition` | object? | virtual | Optional at creation. Once set: all 3 families required |

```text
Line 01                          virtual (derived metrics)
├── Cutter 01                    physical
├── Welder 01                    physical
└── Packer 01                    physical

Quality Overview                 virtual (derived from CNC 01 + Lathe 01 — cross-line)
```

### Hierarchy

Single-parent tree via `parentStationId` for **organizational grouping only**. Does not model product flow or metric calculation.

- Only virtual stations may have children.
- `$graphLookup` for cycle checks.
- **Independent of composition** — a station's parent has nothing to do with its metric sources.

**Parent validations** (on create with `parentStationId` or PATCH `parentStationId`): parent must be virtual, active, not self, not a descendant. Moving a virtual station with children: subtree moves together. Emits `station.hierarchy.changed` on move.

**Backend-driven orphaning**: when a virtual station is archived or hard-deleted, children's `parentStationId` → null (become root). Emits `station.updated` per child.

### Metric Composition

Applies only to virtual stations. **Independent of hierarchy** — contributors can be any active station (physical or virtual), regardless of `parentStationId`. Multi-level derivation supported (virtual → virtual → physical).

| Rule | Contributors | Calculation |
|------|-------------|-------------|
| `primary_station` | Exactly 1 | Metric = contributor's metric |
| `average` | 2+ | Arithmetic mean |
| `weighted` | 2+, each with `weight` (0–1) | Weighted sum (±0.001 tolerance) |

Optional at creation. Once set, all 3 families (`availability`, `productivity`, `quality`) required together. PATCH per-family merge: send only changed family, backend merges + validates final state.

**Validations**: contributor exists, active, not self, no composition cycle (recursive contributor traversal), rules valid, all 3 families present in final state. Virtual contributors must have valid `metricComposition` (all 3 families present and rules valid); composition-less virtual stations cannot be contributors.

**No side-effects on other stations.** Validate → save → emit `station.metric_composition.changed`. No transactions needed. Clearing `metricComposition` is rejected while the station is referenced as a contributor in any other station's composition.

### Schedule

- `StationCalendar`: `validFrom`, `validTo`, `status: active|retired`, `weeklyPattern`. Both station types.
- `DateException`: overrides one local date. Empty intervals = day closed.
- Shift shape: `{ name, startHour, startMinute, endHour, endMinute }`. Night shifts supported.
- `weeklyPattern`: `{ monday: Shift[], ..., sunday: Shift[] }`.
- No overlapping validity windows per station. No overlapping resolved intervals.
- Resolution order: DateException > Calendar weeklyPattern > `shiftIds`. No match = empty array.

### Operator Check-In

Physical stations only. Virtual stations reject check-in attempts.

- `OperatorCheckIn`: `stationId`, `operatorId`, `checkedInAt`, `checkedOutAt?`, `shiftId?`. Operator validated against user-service.
- No duplicate active check-in for same station+operator. Same operator can check in to multiple stations.
- Shift-ended event auto-checks-out open check-ins whose station is scheduled for that shift.

### Action State

Physical stations only. Action-state ingestion (from OEE) requires active physical station. Exception: archive transition may persist one internal clearing snapshot with `activeActions: []` and emit `station.action_state.changed`.

- `StationActionState`: `stationId`, `changedAt`, `activeActions: string[]`.
- Actions: `['downtime', 'operator', 'jobOrder', 'service']` — situations requiring follow-up, not machine run state.
- Snapshot model: new record on each change. Idempotent — identical set skipped.
- OEE detects and sends snapshots. Station-service stores and mirrors `0/1` via `attentionSignalTagId`.

## Station Configuration And Tags

Physical stations only. `tagBindings` are explicit fields:

- `productionCounterTagId` and `runModeTagId`: mandatory.
- `speedTagId`: mandatory when `speed_based`.
- `productivityMode`: `count_based` (discrete, counts items) or `speed_based` (continuous, measures rate).
- `actionSettings` (requires `attentionSignalTagId`): `jobOrderMissingThresholdMs`, `operatorMissingThresholdMs`, `uncausedDowntimeThresholdMs`, `downtimeConfirmationDeadlineMs`, `serviceOverrunThresholdMs`.
- Tags are field signals from PLCs via Fledge, persisted by `tag-service`. Station-service stores only identifiers.

## Lifecycle

Status: `active ↔ archived`. Hard delete from either state if eligible. Archived stations remain queryable.

**Archive (active → archived):**
- Both types: blocked if station is a contributor in any other station's `metricComposition`. Remove from composition first.
- Physical: block if open operator check-ins. Mirror `0` via `attentionSignalTagId`. Persist one internal clearing snapshot (`activeActions: []`) and emit `station.action_state.changed` (idempotency applies — skip if last snapshot already empty). **Keep all config** (preserved for reactivation).
- Virtual: orphan children (`parentStationId → null`), clear `metricComposition`.
- Emits `station.archived` + `station.updated` per orphaned child.

**Reactivate (archived → active):** no auto-restoration of composition or children. Emits `station.reactivated`.

**Hard delete:**
- Both types: blocked if contributor in another composition, has active calendars, or referenced in user-service `stationIds`.
- Physical additionally: blocked if any check-in records exist or any action-state records with non-empty `activeActions` exist (archive clearing snapshots do not count).
- Virtual: orphan children before deletion. Emits `station.deleted` + `station.updated` per child.

## Visibility

- Visible stations = user's `stationIds` in user-service. No descendant/ancestor inheritance.
- On station creation, creator's `stationIds` updated via synchronous internal API call to user-service. If user-service is unavailable, the failure is logged — the creator can manually add the station to their visibility.

## Permissions

| Module | Permissions |
|--------|-------------|
| Station | `readStations`, `writeStations`, `deleteStations` |
| Schedule | `readSchedules`, `writeSchedules` |
| Operators | `readOperators`, `writeOperators` |
| Action State | `readActionState` |

Action state ingestion: internal API only (from OEE). Archive transition may also create one internal clearing snapshot.

## Commands And Queries

- Station: POST (create), PUT (full replace), PATCH (partial update), DELETE (hard delete). Backend detects changed fields and applies validations/side-effects. Type-specific fields rejected for wrong type.
- Calendar: POST, PUT, PATCH, DELETE. Status change via PATCH.
- Date exception: PUT (upsert by station + local date), DELETE.
- Operator check-in (physical only): POST (check-in), PATCH (check-out).
- Internal: shift-ended event handler, action-state snapshot ingestion (physical only).
- Queries: get/list stations, effective schedule, active/historical check-ins, latest/historical action state. Internal: existence check, station lookup, action-state lookup.

## Cross-Cutting Rules

- Station-scoped business writes (calendar, check-in, composition, tag bindings) require active station. Lifecycle transitions (archive, reactivate, hard delete) are exempt.
- Type enforcement on all type-specific operations.
- Hierarchy orphaning (archive/delete of virtual) uses MongoDB transaction.
- Composition updates: no transaction needed (single document).
- Event publication: persist first, publish second. Failure logged, not rolled back.
- External ids validated when owner service available. Stubs for tag-service, OEE, shift service.
- All mutable aggregates use the shared audit log plugin.

## Events

Publish on `events.station`: `station.created`, `station.updated`, `station.archived`, `station.reactivated`, `station.deleted`, `station.hierarchy.changed`, `station.metric_composition.changed`, `station.schedule.changed`, `station.operator.checked_in`, `station.operator.checked_out`, `station.action_state.changed`.

Every event includes `eventId`, `type`, `occurredAt`, `traceId`, and relevant ids.

## External Dependencies

- `user-service`: operator validation, visibility, delete dependency checks.
- `tag-service` (stub): tag identity validation, `attentionSignalTagId` mirroring.
- Shift service (stub): shift definitions for `shiftIds`.
- Future job order / product service: `idealCycleTimeMs`, `idealSpeedPerHour` per product-station pair.
- OEE (stub): action-state snapshot source, detection logic owner.

## Assumptions

- Single factory timezone from deployment config; no per-station timezone.
- Departments/business hierarchy owned by separate future service.
- Hierarchy depth has no explicit limit.
