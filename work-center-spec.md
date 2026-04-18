# WorkCenter-Service Specification

Decision-complete specification for a new on-prem MES `work-center-service`, following the
same structural conventions as `user-service`.

## Summary

- `work-center-service` is a new service app at `work-center/`, using the same conventions
  as `user/`: Express 5, Mongoose 9, Zod 4, shared `@mes/*` packages, `/api/v1` and
  `/internal/v1`, Redis Streams, OpenAPI, health routes, and audit logging.
- It owns work center master data, work center hierarchy, schedules and shift overrides,
  operator check-in/check-out records, and work center tag bindings.
- It does not own raw tag values, time-series, job orders, downtime workflow, alert logic,
  or ideal cycle time / ideal speed parameters (future product-work center model in job
  order service).
- `productivity-service` is a separate future upstream service that calculates OEE and
  downtime. `tag-service` is a separate future upstream service that owns tag identity and
  current tag values.
- Public access requires both a work center permission (for example `readWorkCenters`) and
  that the work center is in the user's `workCenterIds`. Internal routes follow the same
  system-bypass convention as `user-service`.

## Domain Model

Service modules: `workCenter`, `schedule`, `operators`, and `shift`.

### WorkCenter

`WorkCenter` is the core aggregate. It has a single immutable `type` field:

- **Physical**: a real machine with sensors and PLC signals. Has tag bindings,
  productivity mode, and operator check-in. Cannot have children.
- **Virtual**: a grouping (production line, factory area, reporting group). Derives
  metrics from other work centers via `metricComposition`. Can have children. No tags and
  no operator check-in.

If a production line has its own physical sensors, that sensor is modeled as a separate
physical work center.

| Field | Type | Applies to | Notes |
|-------|------|-----------|-------|
| `code` | string | both | Globally unique, stable identifier for SAP/SCADA/PLC (for example `"CNC-01"`) |
| `name` | string | both | Globally unique display name |
| `description` | string? | both | Optional |
| `parentWorkCenterId` | ObjectId? | both | Organizational grouping only. `null = root` |
| `type` | `physical \| virtual` | both | **Immutable** |
| `status` | `active \| archived` | both | |
| `props` | `Map<string, string>` | both | Customer-specific metadata |
| `shiftIds` | `ObjectId[]` | both | References to shifts in the work-center shift catalog |
| `productivityMode` | `count_based \| speed_based` | physical | How output is measured |
| `tagBindings` | object | physical | `productionCounterTagId` (mandatory), `runModeTagId` (mandatory), `speedTagId` (mandatory when `speed_based`) |
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

Single-parent tree via `parentWorkCenterId` for **organizational grouping only**. It does
not model product flow or metric calculation.

- Only virtual work centers may have children.
- `$graphLookup` is used for cycle checks.
- A work center's parent is independent from its metric contributors.

**Parent validations** (on create with `parentWorkCenterId` or PATCH `parentWorkCenterId`):
parent must be virtual, active, not self, and not a descendant. Moving a virtual work
center with children moves the subtree together. Emit `work_center.hierarchy.changed` on
move.

**Backend-driven orphaning**: when a virtual work center is archived or hard-deleted,
children become roots (`parentWorkCenterId -> null`). Emit `work_center.updated` per
child.

### Metric Composition

Applies only to virtual work centers. Contributors can be any active work center
(physical or virtual), regardless of hierarchy. Multi-level derivation is supported
(virtual -> virtual -> physical).

| Rule | Contributors | Calculation |
|------|-------------|-------------|
| `primary_work_center` | Exactly 1 | Metric = contributor's metric |
| `average` | 2+ | Arithmetic mean |
| `weighted` | 2+, each with `weight` (0-1) | Weighted sum with 0.001 tolerance |

Optional at creation. Once set, all 3 families (`availability`, `productivity`,
`quality`) are required together. PATCH supports per-family merge and validates the final
state.

**Validations**: contributor exists, active, not self, no composition cycle (recursive
contributor traversal), rule shape valid, and all 3 families present in final state.
Virtual contributors must already have valid `metricComposition`; composition-less virtual
work centers cannot be contributors.

Clearing `metricComposition` is rejected while the work center is referenced as a
contributor by another work center.

### Schedule

- `WorkCenterCalendar`: `validFrom`, `validTo`, `status: active|retired`,
  `weeklyPattern`. Both work center types.
- `DateException`: overrides one local date. Empty intervals mean the day is closed.
- Shift shape: `{ name, startHour, startMinute, endHour, endMinute }`. Night shifts are
  supported.
- `weeklyPattern`: `{ monday: Shift[], ..., sunday: Shift[] }`.
- No overlapping validity windows per work center. No overlapping resolved intervals.
- Resolution order: `DateException > Calendar weeklyPattern > shiftIds`. No match means
  empty array.

## Shift Module

- The `shift` module inside `work-center` owns a global shift catalog.
- Schedules reference shifts by id; there are no embedded intervals.
- Boundary scheduling is handled in-process by the work-center service.
- Runtime boundary events (`work_center.shift.started`, `work_center.shift.ended`) are
  published on `events.work_center`.
- Auto check-out of operators on shift end is driven by the `work_center.shift.ended`
  event. See `docs/work-center-shift-module-spec.md` for full detail.

### Operator Check-In

Physical work centers only. Virtual work centers reject check-in attempts.

- `OperatorCheckIn`: `workCenterId`, `operatorId`, `checkedInAt`, `checkedOutAt?`,
  `shiftId?`. Operator is validated against `user-service`.
- No duplicate active check-in for the same `workCenter + operator`.
- The same operator may check in to multiple work centers.
- Shift-ended events auto-check-out open check-ins for affected work centers.

## WorkCenter Configuration And Tags

Physical work centers only. `tagBindings` are explicit fields:

- `productionCounterTagId` and `runModeTagId`: mandatory
- `speedTagId`: mandatory when `speed_based`
- `productivityMode`: `count_based` (discrete output) or `speed_based` (continuous rate)
- Tags are field signals from PLCs via Fledge. `work-center-service` stores only
  identifiers.

## Lifecycle

Status: `active ↔ archived`. Hard delete from either state if eligible. Archived work
centers remain queryable.

**Archive (active → archived):**
- Both types: blocked if the work center is a contributor in another work center's
  `metricComposition`.
- Physical: blocked if open operator check-ins exist.
- Virtual: orphan children (`parentWorkCenterId -> null`) and clear `metricComposition`.
- Emit `work_center.archived` plus `work_center.updated` for each orphaned child.

**Reactivate (archived → active):** no auto-restoration of composition or children. Emit
`work_center.reactivated`.

**Hard delete:**
- Both types: blocked if contributor in another composition, has active calendars, or is
  referenced in user-service `workCenterIds`.
- Physical additionally: blocked if any check-in records exist.
- Virtual: orphan children before deletion. Emit `work_center.deleted` plus
  `work_center.updated` per child.

## Visibility

- Visible work centers = user's `workCenterIds` in `user-service`. No descendant or
  ancestor inheritance.
- On work center creation, the creator's `workCenterIds` are updated via synchronous
  internal API call to `user-service`. If `user-service` is unavailable, the failure is
  logged and visibility can be fixed manually later.

## Permissions

| Module | Permissions |
|--------|-------------|
| WorkCenter | `readWorkCenters`, `writeWorkCenters`, `deleteWorkCenters` |
| Schedule | `readSchedules`, `writeSchedules` |
| Operators | `readOperators`, `writeOperators` |

## Commands And Queries

- WorkCenter: POST (create), PUT (full replace), PATCH (partial update), DELETE (hard
  delete)
- Calendar: POST, PUT, PATCH, DELETE
- Date exception: PUT (upsert by work center + local date), DELETE
- Operator check-in (physical only): POST (check-in), PATCH (check-out)
- Internal: shift-ended event handler
- Queries: get/list work centers, effective schedule, active/historical check-ins.
  Internal: existence check and work center lookup.

## Cross-Cutting Rules

- Work-center-scoped business writes (calendar, check-in, composition, tag bindings)
  require active work center. Lifecycle transitions (archive, reactivate, hard delete) are
  exempt.
- Type enforcement on all type-specific operations.
- Hierarchy orphaning (archive/delete of virtual) uses MongoDB transaction.
- Composition updates: no transaction needed (single document).
- Event publication: persist first, publish second. Failure is logged and not rolled back.
- External ids are validated when owner services are available. Stubs are acceptable in
  early phases.
- All mutable aggregates use the shared audit log plugin.

## Events

Publish on `events.work_center`:

- `work_center.created`
- `work_center.updated`
- `work_center.archived`
- `work_center.reactivated`
- `work_center.deleted`
- `work_center.hierarchy.changed`
- `work_center.metric_composition.changed`
- `work_center.schedule.changed`
- `work_center.operator.checked_in`
- `work_center.operator.checked_out`

Every event includes `eventId`, `type`, `occurredAt`, `traceId`, and relevant ids.

## External Dependencies

- `user-service`: operator validation, visibility, delete dependency checks
- `tag-service` (stub): tag identity validation
- `production-service`: shift delete guard via
  `GET /internal/v1/shifts/:id/references`
- Future job order / product service: `idealCycleTimeMs`, `idealSpeedPerHour` per
  product-work center pair
- `productivity-service` (stub): OEE and downtime logic owner

## Assumptions

- One on-prem installation per factory
- No tenant field is required in domain models
- Work center type remains immutable after creation
