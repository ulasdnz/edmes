# WorkCenter-Service Specification

Decision-complete specification for a new on-prem MES `work-center-service`, following the same structural conventions as `user-service`.

## Summary

- `work-center-service` is a new service app at `work-center/`, using the same conventions as `user/`: Express 5, Mongoose 9, Zod 4, shared `@mes/*` packages, `/api/v1` and `/internal/v1`, Redis Streams, OpenAPI, health routes, and audit logging.
- It owns work center master data, work center hierarchy, schedules and shift overrides, operator check-in/check-out records, work center tag bindings, work center action-state snapshots, and work center action-state history queries.
- It does not own raw tag values, time-series, job orders, downtime workflow, service workflow, action detection logic, or ideal cycle time / ideal speed parameters (future product-work center model in job order service).
- `OEE` is a separate future upstream service that detects operational actions. `tag-service` is a separate future upstream service that owns tag identity and current tag values.
- Public access requires both a work center permission (e.g. `readWorkCenters`) and that the work center is in the user's `workCenterIds`. Internal routes follow the same system-bypass convention as `user-service`.

## Domain Model

Service modules: `workCenter`, `schedule`, `operators`, and `state`.

### WorkCenter

`WorkCenter` is the core aggregate. It has a single immutable `type` field:

- **Physical**: a real machine with sensors and PLC signals. Has tag bindings, productivity mode, operator check-in, and action state. Cannot have children.
- **Virtual**: a grouping (production line, factory area, reporting group). Derives metrics from other work centers via `metricComposition`. Can have children. No tags, no operator check-in, no action state.

If a production line has its own physical sensors, that sensor is modeled as a separate physical work center.

| Field | Type | Applies to | Notes |
|-------|------|-----------|-------|
| `code` | string | both | Globally unique, stable identifier for SAP/SCADA/PLC (e.g. `"CNC-01"`) |
| `name` | string | both | Globally unique display name |
| `description` | string? | both | Optional |
| `parentWorkCenterId` | ObjectId? | both | Organizational grouping only. null = root |
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

Single-parent tree via `parentWorkCenterId` for **organizational grouping only**. Does not model product flow or metric calculation.

- Only virtual work centers may have children.
- `$graphLookup` for cycle checks.
- **Independent of composition** — a work center's parent has nothing to do with its metric sources.

**Parent validations** (on create with `parentWorkCenterId` or PATCH `parentWorkCenterId`): parent must be virtual, active, not self, not a descendant. Moving a virtual work center with children: subtree moves together. Emits `work_center.hierarchy.changed` on move.

**Backend-driven orphaning**: when a virtual work center is archived or hard-deleted, children's `parentWorkCenterId` → null (become root). Emits `work_center.updated` per child.

### Metric Composition

Applies only to virtual work centers. **Independent of hierarchy** — contributors can be any active work center (physical or virtual), regardless of `parentWorkCenterId`. Multi-level derivation supported (virtual → virtual → physical).

| Rule | Contributors | Calculation |
|------|-------------|-------------|
| `primary_work_center` | Exactly 1 | Metric = contributor's metric |
| `average` | 2+ | Arithmetic mean |
| `weighted` | 2+, each with `weight` (0–1) | Weighted sum (±0.001 tolerance) |

Optional at creation. Once set, all 3 families (`availability`, `productivity`, `quality`) required together. PATCH per-family merge: send only changed family, backend merges + validates final state.

**Validations**: contributor exists, active, not self, no composition cycle (recursive contributor traversal), rules valid, all 3 families present in final state. Virtual contributors must have valid `metricComposition` (all 3 families present and rules valid); composition-less virtual work centers cannot be contributors.

**No side-effects on other work centers.** Validate → save → emit `work_center.metric_composition.changed`. No transactions needed. Clearing `metricComposition` is rejected while the work center is referenced as a contributor in any other work center's composition.

### Schedule

- `WorkCenterCalendar`: `validFrom`, `validTo`, `status: active|retired`, `weeklyPattern`. Both work center types.
- `DateException`: overrides one local date. Empty intervals = day closed.
- Shift shape: `{ name, startHour, startMinute, endHour, endMinute }`. Night shifts supported.
- `weeklyPattern`: `{ monday: Shift[], ..., sunday: Shift[] }`.
- No overlapping validity windows per work center. No overlapping resolved intervals.
- Resolution order: DateException > Calendar weeklyPattern > `shiftIds`. No match = empty array.

### Operator Check-In

Physical work centers only. Virtual work centers reject check-in attempts.

- `OperatorCheckIn`: `workCenterId`, `operatorId`, `checkedInAt`, `checkedOutAt?`, `shiftId?`. Operator validated against user-service.
- No duplicate active check-in for same work center+operator. Same operator can check in to multiple work centers.
- Shift-ended event auto-checks-out open check-ins whose work center is scheduled for that shift.

### Action State

Physical work centers only. Action-state ingestion (from OEE) requires active physical work center. Exception: archive transition may persist one internal clearing snapshot with `activeActions: []` and emit `work_center.action_state.changed`.

- `WorkCenterActionState`: `workCenterId`, `changedAt`, `activeActions: string[]`.
- Actions: `['downtime', 'operator', 'jobOrder', 'service']` — situations requiring follow-up, not machine run state.
- Snapshot model: new record on each change. Idempotent — identical set skipped.
- OEE detects and sends snapshots. Work-center-service stores and mirrors `0/1` via `attentionSignalTagId`.

## WorkCenter Configuration And Tags

Physical work centers only. `tagBindings` are explicit fields:

- `productionCounterTagId` and `runModeTagId`: mandatory.
- `speedTagId`: mandatory when `speed_based`.
- `productivityMode`: `count_based` (discrete, counts items) or `speed_based` (continuous, measures rate).
- `actionSettings` (requires `attentionSignalTagId`): `jobOrderMissingThresholdMs`, `operatorMissingThresholdMs`, `uncausedDowntimeThresholdMs`, `downtimeConfirmationDeadlineMs`, `serviceOverrunThresholdMs`.
- Tags are field signals from PLCs via Fledge, persisted by `tag-service`. Work-center-service stores only identifiers.

## Lifecycle

Status: `active ↔ archived`. Hard delete from either state if eligible. Archived work centers remain queryable.

**Archive (active → archived):**
- Both types: blocked if work center is a contributor in any other work center's `metricComposition`. Remove from composition first.
- Physical: block if open operator check-ins. Mirror `0` via `attentionSignalTagId`. Persist one internal clearing snapshot (`activeActions: []`) and emit `work_center.action_state.changed` (idempotency applies — skip if last snapshot already empty). **Keep all config** (preserved for reactivation).
- Virtual: orphan children (`parentWorkCenterId → null`), clear `metricComposition`.
- Emits `work_center.archived` + `work_center.updated` per orphaned child.

**Reactivate (archived → active):** no auto-restoration of composition or children. Emits `work_center.reactivated`.

**Hard delete:**
- Both types: blocked if contributor in another composition, has active calendars, or referenced in user-service `workCenterIds`.
- Physical additionally: blocked if any check-in records exist or any action-state records with non-empty `activeActions` exist (archive clearing snapshots do not count).
- Virtual: orphan children before deletion. Emits `work_center.deleted` + `work_center.updated` per child.

## Visibility

- Visible work centers = user's `workCenterIds` in user-service. No descendant/ancestor inheritance.
- On work center creation, creator's `workCenterIds` updated via synchronous internal API call to user-service. If user-service is unavailable, the failure is logged — the creator can manually add the work center to their visibility.

## Permissions

| Module | Permissions |
|--------|-------------|
| WorkCenter | `readWorkCenters`, `writeWorkCenters`, `deleteWorkCenters` |
| Schedule | `readSchedules`, `writeSchedules` |
| Operators | `readOperators`, `writeOperators` |
| Action State | `readActionState` |

Action state ingestion: internal API only (from OEE). Archive transition may also create one internal clearing snapshot.

## Commands And Queries

- WorkCenter: POST (create), PUT (full replace), PATCH (partial update), DELETE (hard delete). Backend detects changed fields and applies validations/side-effects. Type-specific fields rejected for wrong type.
- Calendar: POST, PUT, PATCH, DELETE. Status change via PATCH.
- Date exception: PUT (upsert by work center + local date), DELETE.
- Operator check-in (physical only): POST (check-in), PATCH (check-out).
- Internal: shift-ended event handler, action-state snapshot ingestion (physical only).
- Queries: get/list work centers, effective schedule, active/historical check-ins, latest/historical action state. Internal: existence check, work center lookup, action-state lookup.

## Cross-Cutting Rules

- Work-center-scoped business writes (calendar, check-in, composition, tag bindings) require active work center. Lifecycle transitions (archive, reactivate, hard delete) are exempt.
- Type enforcement on all type-specific operations.
- Hierarchy orphaning (archive/delete of virtual) uses MongoDB transaction.
- Composition updates: no transaction needed (single document).
- Event publication: persist first, publish second. Failure logged, not rolled back.
- External ids validated when owner service available. Stubs for tag-service, OEE, shift service.
- All mutable aggregates use the shared audit log plugin.

## Events

Publish on `events.work_center`: `work_center.created`, `work_center.updated`, `work_center.archived`, `work_center.reactivated`, `work_center.deleted`, `work_center.hierarchy.changed`, `work_center.metric_composition.changed`, `work_center.schedule.changed`, `work_center.operator.checked_in`, `work_center.operator.checked_out`, `work_center.action_state.changed`.

Every event includes `eventId`, `type`, `occurredAt`, `traceId`, and relevant ids.

## External Dependencies

- `user-service`: operator validation, visibility, delete dependency checks.
- `tag-service` (stub): tag identity validation, `attentionSignalTagId` mirroring.
- Shift service (stub): shift definitions for `shiftIds`.
- Future job order / product service: `idealCycleTimeMs`, `idealSpeedPerHour` per product-work center pair.
- OEE (stub): action-state snapshot source, detection logic owner.

## Assumptions

- Single factory timezone from deployment config; no per-work center timezone.
- Departments/business hierarchy owned by separate future service.
- Hierarchy depth has no explicit limit.
