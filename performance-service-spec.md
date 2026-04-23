# Performance-Service Specification

## Summary

The Performance service owns OEE, productivity, quality aggregation, and stop
classification for Aimes core MES.

The first version must support a solid core MES flow:

- collect machine signals from Telemetry,
- use Production job order executions as the production context,
- calculate OEE/productivity for a requested time range,
- create and manage planned and unplanned stop records,
- keep the public API simple for the frontend.

## Design Principles

1. The frontend asks for OEE directly.

   There is no required public "time-context" call before OEE. The frontend calls:

   ```http
   GET /api/v1/oee?workCenterId=...&from=...&to=...
   ```

2. Work Center owns work center metadata.

   Work Center answers: "What is this work center, how is it measured, and how is it
   composed?"

3. Production owns job orders.

   Production answers: "Which job orders were executing in this time range?"

4. Telemetry owns raw machine signals.

   Telemetry answers: "What did the machine signals do in this time range?"

5. Performance owns OEE and stop classification.

   Performance combines job order executions, planned stops, unplanned stops,
   quantities, scrap, and historian summaries.

6. Work calendars are not OEE time gates.

   OEE denominator is based on started job order execution time. Customer-specific
   non-working periods such as lunch, maintenance, tea breaks, or planned closure windows
   must be modeled as planned stops when plant policy says they affect OEE.

7. Deployment scoping stays simple.

   Aimes runs as one on-premises instance per factory installation. Do not add
   deployment-scope fields to domain models, indexes, or API contracts.

## Service Ownership

### Work Center

Owns:

- work centers,
- work center type,
- tag bindings,
- virtual work center metric composition.

Required internal contract:

```http
GET /internal/v1/work-centers/:id
```

The work center response must include type, productivity mode, tag bindings, and
`metricComposition` when the target work center is virtual.

Tag bindings used by Performance:

```ts
tagBindings {
  runModeTagId?: ObjectId
  productionCounterTagId?: ObjectId
  speedTagId?: ObjectId
}
```

Run-mode operational scope is determined by `runModeTagId`, not by a separate
`productivityEnabled` flag. Performance monitors work centers whose Work Center response
includes `tagBindings.runModeTagId`.

`runModeTagId` is mandatory for automatic unplanned stop open/close from run-mode
transitions and live stop flows that depend on the current machine run state.

Work centers without `runModeTagId` are outside run-mode stop automation scope. If a
previously monitored work center loses `runModeTagId`, Performance must stop creating or
managing live run-mode stops for that work center.

A virtual work center may still be requested for OEE without its own `runModeTagId`.
Virtual OEE is calculated by resolving its child work centers through `metricComposition`
and combining their OEE results. The virtual work center itself must not create
run-mode-derived stop records.

### Production

Owns:

- product,
- product standard,
- production plan,
- job order,
- job order start/end,
- quantity adjustment,
- scrap entry.

Required internal contract:

```http
GET /internal/v1/job-orders?workCenterId=...&activeFrom=...&activeTo=...
```

This returns started job orders whose actual execution window intersects the requested
range:

```text
startTime < activeTo AND (endTime == null OR endTime > activeFrom)
```

A still-open job order must use the request `to` as its temporary end for calculation.
Pending job orders are not OEE inputs.

Performance first loads the job orders intersecting the OEE range, then loads child
Production records per job order:

```http
GET /internal/v1/quantity-adjustments?jobOrderId=...&timeFrom=...&timeTo=...
GET /internal/v1/scrap-entries?jobOrderId=...&startTimeTo=...&endTimeFrom=...
```

For each returned job order, use the job order execution window clipped to the OEE query
range as the child-record window:

- Quantity adjustments are signed corrections. Load adjustments whose `time` is inside the
  clipped job order window with `timeFrom`/`timeTo`.
- Scrap entries are interval records. Load scrap entries whose interval overlaps the
  clipped job order window with `startTimeTo=<windowEnd>` and `endTimeFrom=<windowStart>`.
- Both child queries must include `jobOrderId`; stops are not loaded through job orders.

Stop records are not loaded by job order. They are owned by Performance and are read
by work center and time range.

Product standards are revisioned by `validFrom`. Performance must be able to load both
the standard applicable at an exact instant and the standard timeline for a calculation
range:

```http
GET /internal/v1/product-standards/applicable?workCenterId=...&productId=...&at=...
GET /internal/v1/product-standards/timeline?workCenterId=...&productId=...&from=...&to=...
```

The timeline response must include the baseline standard effective at `from`
(`validFrom <= from`) and every later standard revision whose `validFrom` falls inside
`(from, to]`.

Aimes Production already blocks active/overlapping job orders on the same work center.
Performance can rely on that invariant and does not need to add a duplicate
overlapping job order guard.

### Telemetry

Owns:

- tag definitions,
- run mode, counter, and speed historian data,
- produced count summaries,
- speed averages,
- state durations.

Performance uses Telemetry historian endpoints for calculation. Every tag retains full
history in Telemetry, so run mode transitions between reconciliations are never lost and past
OEE results can be recalculated after job order, stop, reason, quantity, scrap, or
product-standard corrections.

Run mode detection uses the Work Center tag binding as the source of truth:

- Work Center provides `runModeTagId` for each work center that should be monitored by
  Performance run-mode stop logic.
- Performance consumes `tag.value.recorded` events from the Telemetry stream only for
  configured run-mode tags. Performance must not consume production-counter or speed-tag
  events for OEE calculation.
- Produced count and speed for OEE are pulled from Telemetry historian summary endpoints at
  query time over the relevant productivity windows, not from raw stream events.
- On startup/restart, Performance must fetch the latest historian sample from Telemetry
  via `GET /internal/v1/historian/:tagId/latest` and reconstruct any missed transitions
  via `GET /internal/v1/historian/:tagId/state-durations` so it can reconcile an
  already-stopped or already-running work center.
- Do not poll "all work centers whose run mode is currently 0" as the primary stop
  source. Use run-mode events as the primary path and historian-based reconciliation as the
  safety net for missed events, restarts, and long-lived stopped states.
- Performance must not subscribe directly to MQTT topics.

### Performance

Owns:

- OEE API,
- reasons,
- planned stops,
- unplanned stops,
- planned stop schedules,
- planned/unplanned stop classification,
- OEE calculation rules.

## OEE Time Rules

### Base Production Time

For each OEE query:

```text
baseProductionTime = started job order execution intervals clipped to the query range
```

This is the only denominator source before planned-stop exclusions. Work Center calendars,
shifts, date exceptions, and operating windows are not used by Performance OEE.

If no started job order intersects the requested range:

```text
denominator = 0
```

The response must return the requested work center with zero factor percentages, zero
duration/output fields, factor statuses set to `no_context`, OEE status set to
`no_context`, and a diagnostic such as `no_job_order_in_range`. Do not return `404` or
omit the response body, because the frontend must distinguish "no OEE context in this
interval" from "work center not found".

### Stops and Uptime

Stop records are stored by work center and time range, not by job order. During OEE
calculation, Performance clips planned and unplanned stops to each job order execution
interval.

For each job order interval:

```text
jobOrderWindow = jobOrder.startTime..(jobOrder.endTime ?? queryTo), clipped to query range
stopTimeInJobOrder = stop intervals intersecting jobOrderWindow
availability windows and productivity windows are derived from each stop reason's
calculation flags
```

Counter and speed summaries used for productivity must be queried or aggregated over
productivity windows. Stops outside started job order execution do not affect OEE,
but the stop record remains available for operations and audit.

### Breaks as Planned Stops

Tea breaks, lunch, cleaning, maintenance, and operator-triggered pauses must be modeled
as planned stops or planned stop schedules when plant policy says they affect OEE. A fixed
daily lunch break is a scheduled planned stop. An operator-triggered break is a manual planned
stop.

## Stop Domain Model

Terminology:

- `PlannedStopSchedule`: time-based recurring definition. It creates scheduled
  `PlannedStop` occurrences.
- `PlannedStopTemplate`: reusable on-demand operator action. It creates one new
  `PlannedStop` occurrence each time an operator starts it.
- `PlannedStop`: one planned stop occurrence. It is the historical record used by OEE.
- `UnplannedStop`: one unplanned stop occurrence created from run mode or manual input.

### Reason

```ts
Reason {
  _id: ObjectId
  code: string
  name: string
  description?: string
  usages: Array<'planned_stop' | 'unplanned_stop' | 'scrap'>
  affectsOee: boolean
  isSystemDefault: boolean
  workCenterIds?: ObjectId[]
  canStartManually: boolean
  canBeScheduled: boolean
  canConvertFromUnplanned: boolean
  requiresDescription: boolean
  isActive: boolean
  props: Record<string, string | number | boolean>
  createdBy: ObjectId
  updatedBy: ObjectId
  createdAt: Date
  updatedAt: Date
}
```

Indexes:

```ts
{ code: 1 } unique
{ name: 1 } unique
{ usages: 1, affectsOee: 1 }
```

Meaning:

- `usages` defines where the reason can be selected. `planned_stop` means the reason is
  valid for `PlannedStop`, `PlannedStopSchedule`, and `PlannedStopTemplate`.
  `unplanned_stop` means the reason is valid for `UnplannedStop`. `scrap` means the reason
  is valid for Production scrap entries that Performance reads for quality calculation.
- `affectsOee` defines whether records using this reason affect the OEE score. The effect
  is interpreted by usage:
  - Stop reasons (`planned_stop` or `unplanned_stop`): `true` means the stop is an
    availability loss; `false` means the stop is reported but excluded from OEE time,
    except for the immutable `MICRO_STOP` reason, which is excluded from the OEE stop
    interval set entirely so its time can remain in productivity target windows.
  - Scrap: `true` means the scrap quantity reduces quality; `false` means the scrap is
    reported as non-OEE scrap and does not reduce quality.
- `workCenterIds` is an optional applicability filter. Empty or missing means the reason
  is globally available.
- `requiresDescription` forces operators to enter a description when assigning this
  reason.
- `isSystemDefault=true` marks Performance-owned reasons created during service bootstrap.
  System-default reasons are part of calculation semantics and must not be edited,
  deactivated, deleted, renamed, or recoded by any user, including system administrators.

Defaults:

- `canStartManually=true`
- `canBeScheduled=false`
- `canConvertFromUnplanned=false`
- `requiresDescription=false`
- `isSystemDefault=false`
- `affectsOee=true`, except `MICRO_STOP`, planned non-production reasons such as lunch or
  tea break, and customer-specific informational scrap reasons.

Stop and scrap records store `reasonId`. OEE resolves `affectsOee` from the current
`Reason` at calculation time. Reasons referenced by historical records must not be
hard-deleted; mark them inactive instead. Updating a reason can intentionally change past
OEE results because OEE is calculated from the current reason policy at request time.

Recommended defaults:

```text
Lunch / tea break / planned non-production stop
  usages=['planned_stop'], affectsOee=false

Machine breakdown / normal unplanned stop
  usages=['unplanned_stop'], affectsOee=true

MICRO_STOP
  usages=['unplanned_stop'], affectsOee=false, isSystemDefault=true

Quality scrap
  usages=['scrap'], affectsOee=true

Informational or non-quality scrap
  usages=['scrap'], affectsOee=false
```

Examples:

- Lunch break: `planned_stop`, `affectsOee=false`, manually startable or schedulable.
- Tea break: `planned_stop`, `affectsOee=false`, manually startable.
- Planned cleaning: `planned_stop`, usually `affectsOee=false`, but the customer may set
  `affectsOee=true` when the plant wants it to count as availability loss.
- Machine stopped, no reason yet: unplanned stop with no reason; treat it as
  `affectsOee=true` until a reason is assigned.
- Minor stop: `unplanned_stop`, usually `affectsOee=true`.
- Micro stop: immutable system-default `unplanned_stop` reason with code `MICRO_STOP` and
  `affectsOee=false`.

### System Default Reasons

Performance must create required system reasons during service bootstrap if they do not
exist. The first system reason is:

```ts
{
  code: 'MICRO_STOP',
  name: 'Micro Stop',
  usages: ['unplanned_stop'],
  affectsOee: false,
  isSystemDefault: true,
  canStartManually: false,
  canBeScheduled: false,
  canConvertFromUnplanned: false,
  requiresDescription: false,
  isActive: true
}
```

`MICRO_STOP` is not customer configuration. It is a calculation primitive. API guards must
reject update, delete, deactivate, rename, recode, usage changes, and `affectsOee` changes
for system-default reasons.

### PlannedStopSchedule

Recurring or scheduled planned stops are separate from realized planned stops.
`PlannedStopSchedule`, `PlannedStop`, and `UnplannedStop` are separate collections. Do not
merge planned and unplanned stop records into one collection.

```ts
PlannedStopSchedule {
  _id: ObjectId
  workCenterIds: ObjectId[]
  reasonId: ObjectId
  plannedOwnerId: ObjectId
  name: string
  description?: string
  occurrenceStartMode: 'automatic' | 'manual'
  recurrence: {
    frequency: 'daily' | 'weekly' | 'monthly'
    daysOfWeek?: Array<
      'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
    >
    timezone: string
    startHour: number
    startMinute: number
  }
  plannedDurationMs: number
  createBeforeStartMs: number // default: 15 * 60 * 1000
  isEnabled: boolean
  props: Record<string, string | number | boolean>
  createdBy: ObjectId
  updatedBy?: ObjectId
  createdAt: Date
  updatedAt: Date
}
```

Indexes:

```ts
{ isEnabled: 1 }
{ workCenterIds: 1 }
{ reasonId: 1 }
```

When a schedule occurrence enters its `createBeforeStartMs` window, Performance creates
a `PlannedStop` occurrence. `createBeforeStartMs` is the lead time before
`plannedStartAt` for creating the occurrence, and defaults to 15 minutes. Schedule
definitions for the same work center must be validated so their generated planned
windows do not overlap.

The recurrence time is interpreted in `recurrence.timezone`. Store materialized
`plannedStartAt` and `plannedEndAt` as UTC instants. `plannedDurationMs` must be positive.

`occurrenceStartMode` controls how the materialized planned stop starts:

- `automatic`: the scheduler starts the occurrence at `plannedStartAt` by applying the
  `Planned Stop Start Rule`.
- `manual`: the scheduler only materializes the occurrence; an operator or authorized
  API/internal command starts it later.

### PlannedStop

One planned stop record represents one manual, scheduled, or converted planned stop.
Every planned stop must have a `reasonId` at creation/materialization time. The selected
reason must be valid for planned-stop usage. Manual starts additionally require
`canStartManually=true`, and scheduled occurrences require `canBeScheduled=true`.

```ts
PlannedStop {
  _id: ObjectId
  workCenterId: ObjectId
  reasonId: ObjectId
  plannedOwnerId: ObjectId
  source: 'manual' | 'scheduled' | 'converted' | 'template'
  startMode: 'automatic' | 'manual'
  status: 'planned' | 'active' | 'closed' | 'cancelled'

  plannedStartAt: Date
  plannedEndAt: Date
  actualStartAt?: Date
  actualEndAt?: Date
  scheduleId?: ObjectId
  templateId?: ObjectId

  operatorId?: ObjectId
  closedBy?: ObjectId
  description?: string
  props: Record<string, string | number | boolean>

  createdBy?: ObjectId
  updatedBy?: ObjectId
  createdAt: Date
  updatedAt: Date
}
```

Status meaning:

- `planned`: created/materialized but not active yet; `actualStartAt` and `actualEndAt` are
  missing, and it does not affect OEE.
- `active`: planned stop is currently running; `actualStartAt` exists,
  `actualEndAt` is missing, and at most one active planned stop is allowed per work center.
- `closed`: completed planned stop; `actualStartAt` and `actualEndAt` exist.
- `cancelled`: ignored by runtime and OEE; it must not be started or closed later.

Indexes:

```ts
{ workCenterId: 1, plannedStartAt: 1, plannedEndAt: 1 }
{ workCenterId: 1, status: 1 } // unique, partial: { status: 'active' }
{ scheduleId: 1, workCenterId: 1, plannedStartAt: 1 } // unique, partial: { source: 'scheduled', scheduleId: { $exists: true } }
{ reasonId: 1 }
```

The unique scheduled occurrence index prevents duplicate planned stops when the scheduler
restarts or retries the same occurrence. `plannedStartAt`/`plannedEndAt` are the intended
window; `actualStartAt`/`actualEndAt` are the realized window used by OEE when present.

### PlannedStopTemplate

Template planned stops are reusable operator actions. They are not stop occurrences
and do not affect OEE by themselves. Each template start creates a new `PlannedStop`
occurrence, so multiple needs breaks on the same day are stored as separate planned stop
records.

Each template must have a `reasonId` whose reason is valid for planned-stop usage and has
`canStartManually=true`, because starting the template immediately creates an active
planned stop.

Use a template when the plant needs a repeatable planned stop button that can be started
at any time, but every use must still be stored as its own historical stop interval.
Examples are needs breaks, smoking breaks, quick restroom breaks, quick cleaning actions,
and other operator-triggered pauses that are planned by policy but not tied to a calendar
time.

Templates exist to avoid creating placeholder planned stops with arbitrary future
`plannedStartAt`/`plannedEndAt` values just to keep a reusable action available. A
schedule is for time-based recurring stops. A template is for on-demand repeatable stops.
A `PlannedStop` record is a single historical occurrence.

```ts
PlannedStopTemplate {
  _id: ObjectId
  workCenterIds: ObjectId[]
  reasonId: ObjectId
  name: string
  description?: string
  defaultDurationMs: number
  plannedOwnerId?: ObjectId
  responsibleUserId?: ObjectId
  overrunPolicy: 'split_to_unplanned' | 'extend_planned_until_close' | 'alert_only'
  overrunReasonId?: ObjectId
  isActive: boolean
  props: Record<string, string | number | boolean>
  createdBy: ObjectId
  updatedBy?: ObjectId
  createdAt: Date
  updatedAt: Date
}
```

Indexes:

```ts
{ workCenterIds: 1, isActive: 1 }
{ reasonId: 1 }
```

`defaultDurationMs` must be positive. `overrunReasonId` is required when
`overrunPolicy='split_to_unplanned'`.

Starting a template creates and starts a new planned stop immediately:

```ts
PlannedStop {
  source: 'template',
  templateId: template._id,
  workCenterId: selectedWorkCenterId,
  reasonId: template.reasonId,
  plannedOwnerId: template.plannedOwnerId ?? currentUserId,
  startMode: 'manual',
  status: 'active',
  plannedStartAt: now,
  plannedEndAt: now + template.defaultDurationMs,
  actualStartAt: now,
  operatorId: currentUserId
}
```

Templates must not create placeholder planned stops before the operator starts them.
They provide an explicit reusable start action while keeping historical stop records as
real per-use `PlannedStop` occurrences.

In the example above, `now`, `selectedWorkCenterId`, and `currentUserId` come from the
start request context. They are not template fields.

### UnplannedStop

One unplanned stop record represents one run-mode or manual unplanned stop.

For v1, live stop features are supported only for work centers that have
`tagBindings.runModeTagId`. This includes run-mode-created unplanned stops, manual
unplanned stops, planned stop start/close flows, planned stop overrun handling, and
run-mode stop processing. A work center without `runModeTagId` may still appear in OEE
through virtual-work-center aggregation, but Performance must not create or manage live
stop records for that work center.

```ts
UnplannedStop {
  _id: ObjectId
  workCenterId: ObjectId
  reasonId?: ObjectId
  source: 'run_mode' | 'manual'

  startAt: Date
  endAt?: Date
  convertedToPlannedStopId?: ObjectId

  operatorId?: ObjectId
  closedBy?: ObjectId
  approvedAt?: Date
  approvedBy?: ObjectId
  description?: string
  props: Record<string, string | number | boolean>

  createdBy?: ObjectId
  updatedBy?: ObjectId
  createdAt: Date
  updatedAt: Date
}
```

Unplanned stop state is derived instead of stored as a separate `status` field:

- open: `endAt` is missing.
- closed: `endAt` exists and `convertedToPlannedStopId` is missing.
- converted: `convertedToPlannedStopId` exists; `endAt` is required.

Indexes:

```ts
{ workCenterId: 1 } // unique, partial: { endAt: null }
{ workCenterId: 1, startAt: 1, endAt: 1 }
{ reasonId: 1 }
```

### RunModeProcessingState

This collection is the persisted idempotency cursor for event-driven run mode processing.
It must be stored in Performance's database, not only in Redis or process memory, because
the service has to survive restarts, retries, and duplicate Telemetry events.
Create this state only for work centers that have `tagBindings.runModeTagId`.

```ts
RunModeProcessingState {
  _id: ObjectId
  workCenterId: ObjectId
  runModeTagId: ObjectId
  lastProcessedOccurredAt: Date
  lastProcessedValue: number
  updatedAt: Date
}
```

Indexes:

```ts
{ workCenterId: 1, runModeTagId: 1 } unique
```

This state is only a processing cursor. It is not the source of truth for OEE. OEE
calculation must still read Telemetry historian/state-duration data for the requested
range.

Startup/retry behavior:

- If a cursor exists, query Telemetry state durations from
  `lastProcessedOccurredAt` to the current time and apply any reconstructed running/stopped
  transitions through the `Run Mode Opens Unplanned Stop` and
  `Run Mode Closes Unplanned Stop` rules.
- If no cursor exists yet, query `GET /internal/v1/historian/:tagId/latest`. If the latest
  sample is stopped (`value < 1`), apply the stopped sample through the debounce-aware
  `Run Mode Opens Unplanned Stop` rule; if it is running, only initialize the cursor.
- Do not create a stop from `latest` alone when historical state-duration data exists for
  the same recovery range. Use state-duration reconstruction first, then use `latest` only
  to confirm the current state.

There must be at most one active planned stop and at most one open unplanned stop per work
center. Planned and unplanned stops must not overlap in OEE calculation; planned start
rules below define how to close or convert unplanned stops before a planned stop becomes
active.

### PerformanceRuntimePolicy

Runtime policy controls how raw run-mode changes become stop records and how productivity
is calculated for a work center.

```ts
PerformanceRuntimePolicy {
  _id: ObjectId
  workCenterId?: ObjectId
  runModeDebounceMs: number
  microStopThresholdMs: number
  actualOutputWindowMode: 'execution_span' | 'net_run_segments'
  productivityAggregationMode: 'total_ratio' | 'run_time_weighted_ratio'
  allowProductivityOver100: boolean
  updatedBy: ObjectId
  updatedAt: Date
}
```

Defaults:

- `runModeDebounceMs=0` records every stopped sample.
- `microStopThresholdMs=120000`.
- `actualOutputWindowMode='execution_span'`.
- `productivityAggregationMode='total_ratio'`.
- `allowProductivityOver100=true`.

`runModeDebounceMs` prevents signal bounce or customer-ignored tiny stops from creating
stop records at all. `microStopThresholdMs` classifies real stop records that pass
debounce but are still brief by assigning the immutable `MICRO_STOP` reason. Work-center-specific policy overrides the factory default.
The productivity fields control how actual output is measured, how multiple job-order
productivity results are aggregated, and whether productivity percentages above 100 are
allowed in responses.

## Stop Runtime Rules

### Run Mode Opens Unplanned Stop

When the bound run mode tag value is `< 1`:

- if there is no active `PlannedStop` covering the event time for the work center, start a
  stopped candidate instead of immediately creating an `UnplannedStop`,
- confirm the stopped candidate only if the run mode remains `< 1` for
  `runModeDebounceMs`,
- when the candidate is confirmed, open an `UnplannedStop` with `source='run_mode'` and
  `startAt` equal to the first stopped event `occurredAt`, not the confirmation time,
- if run mode returns to `>= 1` before `runModeDebounceMs` elapses, cancel the candidate
  and do not create a stop record,
- do not check active job order state before opening the stop,
- do not check Work Center calendars, shifts, date exceptions, or operating windows before
  opening the stop.

These are the only business gates for opening a run-mode unplanned stop: the work center
has no active planned stop covering the event time, the run mode value remains `< 1` after
debounce, and the candidate has not been cancelled by a later running sample.

An active planned stop covers an event time only inside its effective planned interval. By
default that interval ends at `plannedEndAt`; authorized planned-window extension or an
overrun policy may extend it. This distinction prevents a forgotten active planned stop
from hiding run-mode stopped time after its planned window.

Use the Telemetry event `occurredAt` as the `UnplannedStop.startAt`. Compare each run mode
event with `RunModeProcessingState.lastProcessedOccurredAt` for that work center and run
mode tag. Ignore events older than or equal to the cursor, and update the cursor only after the
open/close operation is successfully applied or determined to be already handled.

The debounce mechanism must be restart-safe. The implementation may use a delayed job,
database-backed scheduler, or persisted candidate state; it must not rely only on
in-process timers for production correctness. If `runModeDebounceMs=0`, a stopped sample
can be confirmed immediately, which lets customers record every micro stop.

An existing open `UnplannedStop` is not a business condition for whether the machine is
stopped; it is only an idempotency/duplication guard. Use the unique open-stop constraint
and atomic create/update behavior so repeated stopped samples keep the same open stop
instead of creating duplicates.

Do not add extra business gates beyond the rules above. Stop creation must depend only on
run mode and planned-stop coverage, not on later classification or UI workflow concerns.

### Run Mode Closes Unplanned Stop

When run mode returns to running:

- close the open `UnplannedStop`,
- if the closed duration is less than or equal to `microStopThresholdMs` and the stop does
  not already have an operator-selected reason, assign the system-default `MICRO_STOP`
  reason,
- leave the stop reason empty if the operator has not selected a reason yet.

Close with an atomic condition such as `workCenterId + endAt=null`. If no open stop
matches, treat the close as already handled.

`MICRO_STOP` is an immutable system-default reason with `usages=['unplanned_stop']`.
It keeps micro stops visible in unplanned-stop records while keeping them out of the hot
OEE stop interval set.

### Planned Stop Start Rule

This rule applies whenever a planned stop occurrence becomes active:

- an operator starts an existing `PlannedStop`,
- the scheduler starts a scheduled `PlannedStop` whose `startMode='automatic'`,
- an operator starts a `PlannedStopTemplate`, which first creates a new planned stop
  occurrence and then starts it.

Start behavior:

1. Determine `actualStartAt`. For standard runtime starts this is the request processing
   time. Authorized backdated corrections may provide an explicit start time.
2. Reject the start if another `PlannedStop` is already active on the same work center.
3. If an open `UnplannedStop` exists on the same work center, close it at `actualStartAt`.
4. Mark the planned stop as `active`, set `actualStartAt`, and clear `actualEndAt`.
5. Do not allow planned and unplanned intervals to overlap in OEE calculation.

For retrospective correction, provide a conversion action:

```http
POST /api/v1/unplanned-stops/:id/convert-to-planned
```

This is a correction flow for a stop that was first recorded as unplanned but must be
treated as part of a planned stop. The request may either link the unplanned stop to an
existing planned stop or create a new planned stop from the unplanned interval.

If it creates a planned stop, the created record must use the unplanned interval:

```ts
{
  source: 'converted',
  reasonId: plannedReasonId,
  plannedStartAt: unplannedStop.startAt,
  plannedEndAt: unplannedStop.endAt,
  actualStartAt: unplannedStop.startAt,
  actualEndAt: unplannedStop.endAt
}
```

After conversion, update the unplanned stop with `endAt` if it was still open, and
`convertedToPlannedStopId=<linked planned stop id>`.

The conversion is allowed only if the selected reason has `canConvertFromUnplanned=true`.
Converted `UnplannedStop` records must not be counted as independent unplanned
availability-loss intervals. Their OEE policy comes from the linked `PlannedStop` reason
flags. The linked planned stop must cover the converted unplanned interval, or the
normalizer must handle uncovered parts explicitly. If an existing linked planned stop does
not fully cover it, the normalizer must either require authorized planned-stop extension or
apply the linked planned reason flags to the non-overlapping converted interval parts. In
all cases, merge intervals before aggregation so the same time is never counted twice.
Conversion must not automatically mean denominator exclusion.

If the plant does not want explicit conversion in the first implementation, the simpler
correction flow is to split or update closed unplanned stops and create planned stops
separately. In that case OEE still prevents double counting by applying planned-stop
precedence when planned and unplanned intervals overlap.

### Planned Stop Ends

When a planned stop ends:

- close the active `PlannedStop`,
- resolve the run mode state at `actualEndAt` from Telemetry historian; when closing at the
  current time, the latest historian sample can be used as the current state,
- if the machine is still stopped and no active planned stop covers `actualEndAt`, open a
  new `UnplannedStop` from the planned stop `actualEndAt` unless another unplanned stop is
  already open.

### Manual Planned Stop

Operators may start a planned stop manually if the selected reason has
`canStartManually=true`.

Use cases:

- tea break,
- needs break,
- cleaning,
- planned setup pause,
- other plant-defined planned stop reasons.

Manual and scheduled planned stop creation must reject planned windows that overlap another
non-cancelled `PlannedStop` for the same work center. Use this interval overlap predicate:
`new.plannedStartAt < existing.plannedEndAt && new.plannedEndAt > existing.plannedStartAt`.

### Template Planned Stop

Operators may start a reusable planned stop template if the template is active, assigned to
the work center, and its reason has `canStartManually=true`.

Use cases:

- needs break,
- smoking break,
- quick cleaning action,
- other plant-defined repeatable operator breaks.

Starting a template is atomic:

1. Validate there is no active `PlannedStop` on the work center.
2. If an open `UnplannedStop` exists on the same work center, close it at `now` using the
   `Planned Stop Start Rule`.
3. Create a new `PlannedStop` with `source='template'`, `templateId`, `status='active'`,
   `plannedStartAt=now`, `plannedEndAt=now + defaultDurationMs`, and `actualStartAt=now`.

Here `now` is the template start request processing time, unless an authorized correction
flow explicitly provides a different start time.

Closing a template-created planned stop before `plannedEndAt` simply sets `actualEndAt` and
closes the occurrence. The template remains active and can be started again later,
creating another planned stop occurrence.

If the operator closes it after `plannedEndAt`, apply the template `overrunPolicy`:

- `split_to_unplanned`: keep the template-created `PlannedStop.actualEndAt` as the real
  operator close time for audit, treat the planned portion as ending at `plannedEndAt` for
  OEE, and create an `UnplannedStop` from `plannedEndAt` to `actualEndAt` with
  `overrunReasonId`.
- `extend_planned_until_close`: keep the full actual interval as planned by extending the
  planned stop's effective end to `actualEndAt`. If no separate effective-end field is
  implemented, update `plannedEndAt` to `actualEndAt` as the authorized extension.
- `alert_only`: close at `actualEndAt` and emit an operational diagnostic or work-center
  action for the overrun. It does not automatically split the overrun into an
  `UnplannedStop`, and OEE still uses the standard planned-window cap.

### Scheduled Planned Stop Occurrences

The scheduler must create one `PlannedStop` per work center and occurrence window. It
must use the `scheduleId + workCenterId + plannedStartAt` unique index and treat duplicate
key errors as an already-created occurrence. If an occurrence is created late, keep the
original `plannedStartAt`/`plannedEndAt` and set `actualStartAt` to the actual start time
when the stop becomes active.

Creating the occurrence sets `source='scheduled'`, `status='planned'`, and
`startMode=schedule.occurrenceStartMode`. It does not block unplanned stop creation until
it becomes `active`.

If `startMode='automatic'`, the scheduler must start the occurrence at `plannedStartAt`
using the `Planned Stop Start Rule`. If the scheduler is late, create or load the
occurrence, keep the original `plannedStartAt`/`plannedEndAt`, and start it
immediately with `actualStartAt=now`.

If `startMode='manual'`, the scheduler must not start the occurrence. It remains
`planned` until an operator or authorized API/internal command starts it.

### Backdated Correction

Allow authorized users to correct a past stop interval by:

- assigning a reason,
- changing equipment/operator/description/props,
- splitting a closed unplanned stop into contiguous closed unplanned stops,
- converting an unplanned stop to a planned stop if the reason allows it,
- creating a closed planned stop interval for a past period if the plant explicitly
  permits backdated correction.

Any correction must be auditable. V1 OEE is calculated on demand, so corrections affect
the next OEE response without cache invalidation.

## OEE Calculation Rules

### Implementation Priorities

The calculation code must prioritize correctness first, then hot-path performance, then
implementation simplicity. Do not optimize by changing calculation semantics.

Guidelines for implementation agents:

- Prefer simple, deterministic code that is easy to test.
- Use bulk queries, projection, and batching when they clearly reduce request count,
  database load, or memory use on the OEE hot path.
- Use well-known interval algorithms where they clearly improve correctness or hot-path
  performance.
- Do not introduce advanced data structures, read models, or caching for V1 unless profiling
  proves the simpler approach is insufficient.
- Do not call controller methods in loops to simulate batch endpoints. Implement real bulk
  service/repository queries.
- Do not load full Mongo documents when OEE needs only a small projected shape. Query only
  the fields needed for calculation and response. In TypeScript, prefer local `type`
  definitions or inferred schemas; do not create Java-style `dto` files unless the existing
  module already uses that convention.

### Inputs

For a query:

```http
GET /api/v1/oee?workCenterId=...&from=...&to=...
```

Performance loads:

- work center tag bindings and metric composition from Work Center through internal HTTP,
- started job orders intersecting the query range from Production through internal HTTP,
- product standard timelines from Production through internal HTTP,
- quantity adjustments and scrap entries from Production through internal HTTP,
- run-mode state information plus production counter and speed summaries from Telemetry
  through internal HTTP,
- reason policy, runtime policy, planned stops, and unplanned stops from Performance's
  local services/repositories. Do not call Performance's own public HTTP API from inside
  the service.

Independent inputs must be loaded in parallel where possible. Dependent inputs must wait
for their parent data. The hot path should follow this staged shape:

```ts
const [workCenter, policy, microStopReasonId, nonOeeReasonIds, jobOrders, rawStops] =
  await Promise.all([
    workCenterClient.getById(workCenterId), // internal HTTP to Work Center service
    policyService.resolveForWorkCenter(workCenterId), // local
    reasonService.getSystemReasonIdByCode('MICRO_STOP'), // local, returns ObjectId
    reasonService.findIds({
      affectsOee: false,
      usages: ['planned_stop', 'unplanned_stop', 'scrap']
    }), // local, returns ObjectId[]
    productionClient.findStartedJobOrders({ workCenterId, from, to }), // internal HTTP to Production service
    stopRepository.findForOee({
      workCenterId,
      from,
      to,
      excludeSystemReasonCodes: ['MICRO_STOP']
    }) // local, excludes MICRO_STOP in the query/repository layer
  ])

const [productStandards, quantityAdjustments, scrapEntries] = await Promise.all([
  productionClient.findProductStandardTimelines(jobOrders), // internal HTTP to Production service
  productionClient.findQuantityAdjustments(jobOrders), // internal HTTP to Production service
  productionClient.findScrapEntries(jobOrders) // internal HTTP to Production service
])
```

Telemetry summaries are loaded after `actualOutputWindows` are known, because the selected
window mode determines which windows are sent to Telemetry.

### Internal Batch Contracts

OEE must avoid many small internal HTTP calls when a query range contains multiple job
orders or many production windows. Batch endpoints keep the semantics of the existing
single-range operations, but accept multiple windows/items in one request.

#### Produced Summary Batch

`produced-summary` has the same meaning as the existing single-range produced/cumulative
summary. The only difference is that it accepts multiple windows.

```http
POST /internal/v1/historian/:tagId/produced-summary
```

```ts
{
  windows: Array<{ from: string; to: string }>
}
```

```ts
{
  windows: Array<{
    from: string
    to: string
    value: number
    qualityFlags: string[]
  }>
  total: {
    value: number
  }
}
```

Telemetry remains responsible for counter reset, rollover, duplicate sample, and historian
edge cases. Performance uses the returned values directly.

#### Speed Summary Batch

Speed-based productivity must use Telemetry `speed-summary` for both
`actualOutputWindowMode='execution_span'` and
`actualOutputWindowMode='net_run_segments'`.

```http
POST /internal/v1/historian/:tagId/speed-summary
```

```ts
{
  windows: Array<{ from: string; to: string }>
}
```

```ts
{
  windows: Array<{
    from: string
    to: string
    durationMs: number
    timeWeightedAverage: number
    valueArea: number
    sampleCount: number
    qualityFlags: string[]
  }>
  total: {
    durationMs: number
    timeWeightedAverage: number
    valueArea: number
  }
}
```

This replaces raw speed sample integration inside Performance. Telemetry must handle the
sample before `from` as the baseline when needed, carry the last value forward until `to`,
calculate the time-weighted average, calculate `valueArea`, and report quality flags such
as missing baseline or sample gaps. Performance converts the returned summary to
output-equivalent units with product standards.

#### Product Standard Timeline Batch

When an OEE query contains multiple job orders, load product standard timelines in one
batch request.

```http
POST /internal/v1/product-standards/timelines:batch
```

```ts
{
  items: Array<{
    jobOrderId: string
    workCenterId: string
    productId: string
    from: string
    to: string
  }>
}
```

```ts
{
  items: Array<{
    jobOrderId: string
    standards: ProductStandard[]
    qualityFlags: string[]
  }>
}
```

This endpoint keeps the same standard-selection semantics as the single timeline endpoint:
include the baseline standard effective at `from` and revisions whose `validFrom` falls in
the requested range. Production must implement this as a real bulk query/grouping path, not
as a loop that calls the single-item service/controller repeatedly.

#### Job Order Records Batch

Quantity adjustments and scrap entries must also support a batch request. Use the same
endpoint for one job order or many job orders so the OEE code path stays simple.

```http
POST /internal/v1/job-order-records:batch
```

```ts
{
  items: Array<{
    jobOrderId: string
    from: string
    to: string
  }>
  include: Array<'quantity_adjustments' | 'scrap_entries'>
}
```

```ts
{
  quantityAdjustmentsByJobOrderId: Record<string, QuantityAdjustment[]>
  scrapEntriesByJobOrderId: Record<string, ScrapEntry[]>
}
```

Batch endpoints must use projection and minimal response shapes. Return only fields needed
by OEE calculation and response. This reduces response size, memory use, and serialization
cost without changing behavior. In TypeScript code, model these shapes as `type`s or
schema-inferred types near the owning module rather than creating separate `dto` files by
default.

For physical work centers, Performance calculates OEE directly from that work center's
started job orders, tag bindings, production records, and stops.

For virtual work centers, Performance must first resolve the virtual work center's
`metricComposition`, calculate the contributing child work centers, then combine
availability, productivity, and quality according to the composition rule for each factor.
If a contributor is also virtual, resolve it recursively until physical leaf work centers
are reached. Virtual work centers must not create their own telemetry-derived stop
records; stops remain tied to the physical work center where they occurred.

For calculation, Performance normalizes `PlannedStop` and `UnplannedStop` records into
internal stop intervals. Unplanned stops linked through `convertedToPlannedStopId`
inherit the calculation flags from the linked `PlannedStop` reason and must be merged with
the linked planned interval to prevent double counting.

For a `PlannedStop`, actual OEE must use the realized interval when present, capped by
the planned window unless an authorized user extends it: start at
`actualStartAt ?? plannedStartAt`; end at `actualEndAt` if present, otherwise the earlier of
the query end/current time and `plannedEndAt`; then cap at `plannedEndAt`. A future
`PlannedStop` with no `actualStartAt` must not reduce current actual OEE. If a planned stop
starts late, the missed planned portion must not be counted as a stop.

### Interval Normalization

OEE calculation must use a single deterministic interval normalizer for job order windows
and stop intervals. The normalizer is responsible for clipping, overlap handling, and
building `productionRunWindows`.

Performance requirement:

- Sort job order windows and stop intervals once by start time.
- Use sorted interval merge plus a two-pointer sweep over sorted windows instead of nested
  full scans when the requested range can contain many intervals.
- Complexity should be approximately `O(j log j + s log s + j + s)` for `j` job windows
  and `s` stop intervals in the requested range.
- Ignore zero or negative duration intervals after clipping.
- Keep the implementation simple. Do not use interval trees, segment trees, persistent
  range indexes, or a read model for V1 unless profiling shows sorted merge/sweep is
  insufficient.

Pseudo-code:

```text
jobOrderWindows =
  started job order execution intervals clipped to query from/to, sorted by start

rawStops =
  planned and unplanned stops loaded for the work center and query range,
  excluding unplanned stops with system reason code MICRO_STOP

candidateStopIntervals =
  rawStops converted to realized stop intervals and clipped to query from/to

calculationStops =
  normalizeOverlaps(candidateStopIntervals)

productionRunWindows = []

for each jobWindow in jobOrderWindows:
  overlappingStops = calculationStops that intersect jobWindow
  clippedStops = clip overlappingStops to jobWindow
  mergedStops = union clippedStops by time, with planned stops taking precedence over
                unplanned stops when historical overlap exists

  subtract mergedStops from jobWindow to append stop-free segments to productionRunWindows
  aggregate stop durations from mergedStops into availability counters
```

`normalizeOverlaps` must never count the same millisecond twice. If planned and unplanned
records overlap historically, planned intervals take precedence and unplanned intervals are
clipped or split deterministically. The OEE response still calculates from the normalized
intervals and includes a warning diagnostic such as `overlapping_stop_records_clipped`.
This diagnostic does not make any factor `not_calculable`.

The normalizer must clip all intervals to the OEE query range first, then to the
intersecting job order window where applicable. This applies to job orders, planned stops,
unplanned stops, quantity adjustments, scrap intervals, product-standard timelines, and
Telemetry windows. Correct clipping is part of correctness, not an optimization.

`MICRO_STOP` records are excluded before stop interval normalization. Therefore they do not
reduce `effectiveRunTimeMs`, do not reduce `oeeEligibleTimeMs`, and do not split
`productionRunWindows`. Their time remains inside productivity target windows, matching
the intended micro-stop behavior.

### Availability

```text
microStopReasonCode = 'MICRO_STOP'
nonOeeReasonIds =
  reason ids where affectsOee=false and usage is planned_stop, unplanned_stop, or scrap
calculationStops =
  planned and unplanned stops overlapping the work center and query range,
  excluding unplanned stops whose reason code is MICRO_STOP

jobOrderTimeMs = baseProductionTime
oeeEligibleTimeMs = jobOrderTimeMs
effectiveRunTimeMs = jobOrderTimeMs
oeeAffectingStopMs = 0
nonEffectiveStopMs = 0
productionRunWindows = job order windows clipped to the query range

for each stop in calculationStops clipped to job order windows:
  effectiveRunTimeMs -= stopDurationMs
  split productionRunWindows by the clipped stop interval

  if stop.reasonId is in nonOeeReasonIds:
    oeeEligibleTimeMs -= stopDurationMs
    nonEffectiveStopMs += stopDurationMs
  else:
    oeeAffectingStopMs += stopDurationMs

availability = effectiveRunTimeMs / oeeEligibleTimeMs
```

Notes:

- At the start of an OEE calculation, Performance loads the current non-effective reason
  ids through its local Reason service/repository. The public API exposes the same filter
  shape for UI and diagnostics:
  `GET /api/v1/reasons?affectsOee=false&usage=planned_stop,unplanned_stop,scrap&fields=_id`.
- The implementation may call this set `nonOeeReasonIds`.
- `MICRO_STOP` is resolved by its immutable system code and is excluded from
  `calculationStops` before interval math. Micro stops remain stored as unplanned stops for
  operational screens, but the OEE hot path does not load them by default.
- The repository may resolve `MICRO_STOP` to its internal id before querying, but the
  calculation rule is expressed in domain terms as the immutable reason code, not as a
  customer-editable id list.
- A stop with no reason is treated as OEE-affecting until a reason is assigned.
- Normal OEE-affecting stops reduce `effectiveRunTimeMs` but keep `oeeEligibleTimeMs`
  unchanged, so availability decreases.
- Non-effective stops reduce both `effectiveRunTimeMs` and `oeeEligibleTimeMs`, so the
  stop remains visible in reports but does not reduce the availability percentage.
- Example: a 100 minute job order with a 10 minute OEE-affecting stop returns
  `effectiveRunTimeMs=90`, `oeeEligibleTimeMs=100`, `availability=90%`.
- Example: a 100 minute job order with a 10 minute non-effective stop returns
  `effectiveRunTimeMs=90`, `oeeEligibleTimeMs=90`, `availability=100%`.
- Micro stops do not reduce either value and do not split `productionRunWindows`; therefore
  their time remains inside productivity target windows.
- Stop intervals must be clipped to the query range and started job order intervals.
- Stop interval sets must be unioned before aggregation so overlapping records never
  count the same millisecond twice.
- Stops outside started job order execution do not affect OEE.
- Overlapping planned/unplanned intervals on the same work center must be prevented. If
  historical overlap is found, planned intervals take precedence, unplanned intervals are
  split or clipped deterministically, and the response must include a diagnostic warning.

### Productivity

For count-based work centers:

```text
jobOrderWindows = started job order intervals clipped to the query range
productionRunWindows = jobOrderWindows minus calculationStops

actualOutputWindows =
  jobOrderWindows when actualOutputWindowMode='execution_span'
  productionRunWindows when actualOutputWindowMode='net_run_segments'

actualOutput = gross produced count over actualOutputWindows + quantity adjustments
effectiveTargetOutput =
  sum(productionRunWindow minutes * segmentProductStandard.idealOutputPerMinute)
fullJobTargetOutput =
  sum(jobOrderWindow minutes * segmentProductStandard.idealOutputPerMinute)
productivityRatio = actualOutput / effectiveTargetOutput
```

For speed-based work centers:

```text
actualOutputWindows =
  jobOrderWindows when actualOutputWindowMode='execution_span'
  productionRunWindows when actualOutputWindowMode='net_run_segments'

actualSpeedArea = historian speed area over actualOutputWindows
actualOutput = convert actualSpeedArea to output-equivalent units using the active product standard
effectiveTargetOutput =
  output target over productionRunWindows using the active product standard
fullJobTargetOutput =
  output target over jobOrderWindows using the active product standard
productivityRatio = actualOutput / effectiveTargetOutput
```

`productionRunWindows` are produced by the availability interval calculation and their
total duration equals `effectiveRunTimeMs`. They remove OEE-affecting stops and
non-effective stops, but they do not remove `MICRO_STOP` intervals because micro stops are
excluded from `calculationStops`. This matches the intended behavior: micro stops do not
reduce availability, but they can reduce productivity because the target continues through
that time.

`actualOutputWindowMode='execution_span'` is the default because counters usually stop
increasing while the machine is stopped and this mode requires fewer fragmented historian
queries. `actualOutputWindowMode='net_run_segments'` is stricter and reads counter or
speed data only from the stop-free production windows.

Known behavior: with `actualOutputWindowMode='execution_span'`, actual output is read over
the clipped job order windows while `effectiveTargetOutput` is still calculated over
`productionRunWindows`. If production is recorded during a planned non-effective stop, that
output can increase productivity because the stop removed target time but not actual
output. This is intentional for the default mode and can be avoided by using
`actualOutputWindowMode='net_run_segments'`.

Productivity is calculated internally as a 0..1 ratio. Public `percentage` fields are
created only at the response boundary by multiplying the final ratio by 100 and rounding.
Use decimal-safe arithmetic or a single final rounding step; do not repeatedly round or
work with percentage values inside the calculation.

When multiple job orders contribute to the range, Performance must calculate a
job-order-level productivity breakdown first:

```ts
JobOrderProductivityBreakdown {
  jobOrderId: ObjectId
  actualOutput: number
  quantityAdjustment: number
  effectiveTargetOutput: number
  fullJobTargetOutput: number
  productionRunMs: number
  productivityRatio: number
}
```

Aggregation modes:

```text
total_ratio:
  productivityRatio = sum(actualOutput) / sum(effectiveTargetOutput)

run_time_weighted_ratio:
  productivityRatio =
    sum(jobOrder.productivityRatio * jobOrder.productionRunMs) /
    sum(jobOrder.productionRunMs)
```

If `allowProductivityOver100=false`, cap each job-order ratio at `1` before time-weighted
aggregation and cap the final response ratio at `1`. If `allowProductivityOver100=true`,
do not cap productivity above 100 because overproduction and corrected standards can be
valid signals.

`fullJobTargetOutput` is not the productivity denominator. It exists for reporting and
operator-panel comparison: "what would the target have been over the whole job order
window?" The productivity denominator is `effectiveTargetOutput`.

Product standards may change while a job order is running. Performance must split
productivity windows at product standard `validFrom` boundaries and use the standard effective
for each sub-interval. The standard timeline for a range must therefore include the
baseline standard effective at the range start plus every later revision in
`(rangeStart, rangeEnd]`. If no baseline standard exists for a job order interval, the
response must include a diagnostic and exclude that interval from target-based
productivity calculation.

### Quality

```text
total = gross produced count + quantity adjustments
oeeAffectingScrap = scrap entries whose reasonId is missing, unknown, or not in nonOeeReasonIds
excludedScrap = scrap entries whose reasonId is in nonOeeReasonIds
good = max(total - oeeAffectingScrap, 0)
quality = good / total
```

The production counter is treated as a gross count from the field signal. Scrap is entered
separately by Production and subtracted only in the quality calculation when its current
reason has `affectsOee=true`. Quantity adjustments are signed and are applied to total
production before OEE-affecting scrap is subtracted. Scrap with `affectsOee=false` remains
visible in the response as excluded/non-OEE scrap but does not reduce quality.
If a scrap entry has no `reasonId`, treat it as OEE-affecting. If a scrap entry references
an unknown reason id, treat it as OEE-affecting and add a warning diagnostic such as
`unknown_scrap_reason_treated_as_oee_affecting`.

If `total <= 0`, set `quality.percentage=0`, `quality.good=0`, `quality.total=0`, and
include a diagnostic such as `no_production_total`. If `oeeAffectingScrap > total`, clamp
`good` to zero for the response and include a diagnostic such as `scrap_exceeds_total`.

### OEE

```text
oee = availability * productivity * quality
```

Internal formulas use 0..1 ratios. Public API `percentage` fields are 0..100 values.
Clamp negative response percentages to zero, but do not cap values above 100 because
overproduction or data corrections can legitimately produce values greater than 100. Keep
raw calculation ratios in diagnostics when needed for debugging.

## Public API

### OEE

```http
GET /api/v1/oee?workCenterId=...&from=...&to=...
```

Use query parameters instead of nesting OEE under `/work-centers/:id` because OEE is a
reporting resource, but keep the v1 API scoped to one work center per request. The
frontend sends one `workCenterId`, one ISO `from`, and one ISO `to`. Pagination and
grouping do not apply to this endpoint.

Response shape:

```ts
{
  data: {
    workCenterId: string
    from: string
    to: string
    availability: {
      status: 'ok' | 'no_context' | 'not_calculable'
      percentage: number
      jobOrderTimeMs: number
      oeeEligibleTimeMs: number
      effectiveRunTimeMs: number
      oeeAffectingStopMs: number
      nonEffectiveStopMs: number
    }
    productivity: {
      status: 'ok' | 'no_context' | 'not_calculable'
      percentage: number
      actualOutput?: number
      effectiveTargetOutput?: number
      fullJobTargetOutput?: number
      quantityAdjustment?: number
      actualOutputWindowMode: 'execution_span' | 'net_run_segments'
      aggregationMode: 'total_ratio' | 'run_time_weighted_ratio'
      jobOrders: Array<{
        jobOrderId: string
        actualOutput: number
        quantityAdjustment: number
        effectiveTargetOutput: number
        fullJobTargetOutput: number
        productionRunMs: number
        percentage: number
      }>
    }
    quality: {
      status: 'ok' | 'no_context' | 'not_calculable'
      percentage: number
      good: number
      total: number
      oeeAffectingScrap: number
      excludedScrap: number
      totalScrap: number
    }
    oee: {
      status: 'ok' | 'no_context' | 'not_calculable'
      percentage: number
    }
    diagnostics: Array<{
      code: string
      severity: 'info' | 'warning' | 'error'
      workCenterId?: string
      from?: string
      to?: string
      message: string
    }>
  }
}
```

Factor status:

- `ok`: the factor was calculated from valid context. Warning diagnostics may still be
  present.
- `no_context`: there is no production context for the factor, such as no started job
  order in the requested range. Percentages return `0`.
- `not_calculable`: required calculation data is missing or invalid, such as a missing
  product standard for a job order segment. The affected factor percentage returns `0`,
  and OEE status becomes `not_calculable`.

Diagnostic severity:

- `info`: explanatory context; the response is valid.
- `warning`: the response is calculated deterministically, but data should be reviewed.
- `error`: at least one factor is `not_calculable`; the response is returned with `0` for
  the affected factor instead of pretending the value is real.

Diagnostic catalog for v1:

```text
no_job_order_in_range: info, factors no_context, OEE no_context.
missing_product_standard: error, productivity not_calculable, OEE not_calculable.
no_production_total: info, quality no_context or zero-output context.
scrap_exceeds_total: warning, quality calculated with good clamped to zero.
unknown_scrap_reason_treated_as_oee_affecting: warning, quality calculated defensively.
overlapping_stop_records_clipped: warning, OEE calculated from normalized intervals.
micro_stop_reason_missing: error, system invariant failure; request should fail rather
  than calculate with undefined MICRO_STOP behavior.
telemetry_summary_incomplete: warning or error depending on whether the missing summary
  prevents the affected factor from being calculated.
```

### Reasons

```http
GET /api/v1/reasons
GET /api/v1/reasons?affectsOee=false&usage=planned_stop,unplanned_stop,scrap&fields=_id
POST /api/v1/reasons
GET /api/v1/reasons/:id
PATCH /api/v1/reasons/:id
DELETE /api/v1/reasons/:id
```

`DELETE /api/v1/reasons/:id` must be a soft delete/deactivation when any stop references
the reason. Referenced reasons must remain readable for historical OEE recalculation.

The OEE calculator may request only reason ids for filtering. `usage` accepts one or more
comma-separated usage values. `fields=_id` returns only identifiers to keep the hot OEE
calculation path small.

### Planned Stops

```http
GET /api/v1/planned-stops?workCenterId=...&from=...&to=...&status=...
POST /api/v1/planned-stops
POST /api/v1/planned-stops/:id/start
POST /api/v1/planned-stops/:id/close
PATCH /api/v1/planned-stops/:id
```

`POST /api/v1/planned-stops` may be used for creating a planned stop, including an
authorized backdated closed interval if the plant policy allows it.

### Planned Stop Templates

```http
GET /api/v1/planned-stop-templates?workCenterId=...
POST /api/v1/planned-stop-templates
GET /api/v1/planned-stop-templates/:id
PATCH /api/v1/planned-stop-templates/:id
DELETE /api/v1/planned-stop-templates/:id
POST /api/v1/planned-stop-templates/:id/start
```

`POST /api/v1/planned-stop-templates/:id/start` creates a new active `PlannedStop`
occurrence from the template. It does not mutate or consume the template.

### Unplanned Stops

```http
GET /api/v1/unplanned-stops?workCenterId=...&from=...&to=...&state=open|closed|converted
POST /api/v1/unplanned-stops
POST /api/v1/unplanned-stops/:id/close
POST /api/v1/unplanned-stops/:id/convert-to-planned
PATCH /api/v1/unplanned-stops/:id
```

`state` is a derived filter, not a stored field.

### Planned Stop Schedules

```http
GET /api/v1/planned-stop-schedules
POST /api/v1/planned-stop-schedules
GET /api/v1/planned-stop-schedules/:id
PATCH /api/v1/planned-stop-schedules/:id
DELETE /api/v1/planned-stop-schedules/:id
```

## Internal API Dependencies

### Work Center

```http
GET /internal/v1/work-centers/:id
```

The work center response must include type, productivity mode, tag bindings, and
`metricComposition` when the target work center is virtual.

Run-mode operational scope is determined by `runModeTagId`. Performance monitors work
centers whose Work Center response includes `tagBindings.runModeTagId`.

`runModeTagId` is mandatory for automatic unplanned stop open/close from run-mode
transitions and live stop flows that depend on the current machine run state. Work
centers without `runModeTagId` are outside run-mode stop automation scope. If a
previously monitored work center loses `runModeTagId`, Performance must stop creating or
managing live run-mode stops for that work center.

A virtual work center may still be requested for OEE without its own `runModeTagId`.
Virtual OEE is calculated by resolving its child work centers through `metricComposition`
and combining their OEE results. The virtual work center itself must not create
run-mode-derived stop records.

### Production

```http
GET /internal/v1/job-orders?workCenterId=...&activeFrom=...&activeTo=...
POST /internal/v1/product-standards/timelines:batch
POST /internal/v1/job-order-records:batch
```

The `job-orders` active-range query is the primary OEE context input. Product standards,
quantity adjustments, and scrap entries must be loaded through the batch endpoints above on
the OEE hot path. Single-item endpoints such as
`GET /internal/v1/product-standards/timeline`, `GET /internal/v1/quantity-adjustments`, and
`GET /internal/v1/scrap-entries` may exist for debug, admin, or fallback use, but
Performance OEE implementation must not loop over those single-item endpoints when batch
endpoints are available.

The batch endpoints are required internal dependencies for Performance OEE. If they are not
present in Production yet, implementation must add them before wiring the Performance hot
path instead of degrading to many small HTTP requests.

### Telemetry

Use historian summary endpoints designed for the OEE hot path:

```http
GET /internal/v1/historian/:tagId/produced?from=...&to=...
GET /internal/v1/historian/:tagId/speed-avg?from=...&to=...
POST /internal/v1/historian/:tagId/speed-summary
GET /internal/v1/historian/:tagId/state-durations?from=...&to=...
GET /internal/v1/historian/:tagId/latest
```

Performance must calculate produced count and speed only over the selected
`actualOutputWindows`. Prefer multi-window summary endpoints. Do not make one HTTP request
per window when a multi-window endpoint exists.

For speed-based productivity, Performance must not fetch raw speed samples and integrate
them itself. Telemetry owns historian interpolation, previous-sample lookup, sample gaps,
and time-weighted speed area calculation. `speed-summary` accepts multiple windows:

```ts
{
  windows: Array<{ from: string; to: string }>
}
```

It must return enough information for Performance to derive speed-based output, such as
`durationMs`, `timeWeightedAverage`, and `valueArea` per window and in total.

The `latest` endpoint returns the last persisted historian sample for the tag
(`{ tagId, value, occurredAt }`), or `null` if the tag has no samples yet. It is used for
startup/current-status checks but is not the source of truth for historical OEE
reconstruction. Performance must reconstruct missed intervals from `state-durations`,
which segments binary tags from historian samples and uses the sample preceding `from` as
the baseline. `state-durations` is the authoritative endpoint for run mode stop
reconstruction.

`state-durations` must not invent a stopped or running state before the first known sample.
If there is no baseline sample before `from`, the first returned segment starts at the first
sample inside the range. If there is no baseline and no sample inside the range, the result
is empty.

## Events

Events use Redis Stream name and event type separately.

Performance must consume:

- stream `events.production`, types `job_order.started`, `job_order.ended`,
  `job_order.updated`, `job_order.deleted`, `quantity_adjustment.created`,
  `quantity_adjustment.updated`, `quantity_adjustment.deleted`, `scrap_entry.created`,
  `scrap_entry.updated`, `scrap_entry.deleted`, `product_standard.created`,
  `product_standard.updated`, `product_standard.deleted`;
- stream `events.work_center`, types `work_center.created`, `work_center.updated`,
  `work_center.archived`, `work_center.reactivated`, `work_center.deleted`,
  `work_center.metric_composition.changed`;
- stream `events.telemetry`, type `tag.value.recorded` only for run-mode tags bound to
  relevant work centers.

Performance must emit on stream `events.performance`:

- `planned_stop.created`
- `planned_stop.started`
- `planned_stop.closed`
- `planned_stop.updated`
- `planned_stop_template.created`
- `planned_stop_template.updated`
- `planned_stop_template.deleted`
- `planned_stop_template.started`
- `unplanned_stop.opened`
- `unplanned_stop.closed`
- `unplanned_stop.updated`
- `unplanned_stop.converted`
- `planned_stop_schedule.created`
- `planned_stop_schedule.updated`
- `planned_stop_schedule.deleted`

`realtime-service` must subscribe to `events.performance` and forward these events to
client rooms the same way it already forwards other domain streams. At minimum, payloads
that include `workCenterId` must reach the matching `wc:{workCenterId}` room so live
stop and performance UI can update without polling.

V1 calculates OEE on demand and does not persist OEE result caches. Domain events do not
invalidate OEE results because there is no OEE read model in V1.

## Edge Cases

### Job Order Open Across Multiple Days

If a job order stays open for two days:

- the full started job order execution interval inside the query range is OEE denominator,
  unless stop reason flags exclude parts of it,
- calendar gaps, missing shifts, or closed-day exceptions do not automatically remove time
  from OEE,
- if the customer does not want lunch, weekend, maintenance, or overnight idle time in
  OEE, that time must be represented by planned stops or by closing/pausing the job order.

### Product Standard Changes During Production

If a new product standard revision becomes effective while a job order is running:

- split the affected productivity windows at the revision `validFrom`,
- use the previous standard until the revision boundary,
- use the new standard from the revision boundary onward,
- keep one OEE response for the requested interval, but calculate target values from the
  split sub-intervals.

### Virtual Work Center OEE

If the requested work center is virtual:

- resolve its metric composition from Work Center,
- calculate each contributing work center for the requested range, recursively when a
  contributor is also virtual,
- combine availability, productivity, and quality according to the virtual work center's
  composition rule for each factor,
- return diagnostics when a contributor cannot be calculated, instead of silently treating
  the contributor as zero.

### Operator Starts Tea Break

Tea break is a planned stop reason with:

```ts
{
  usages: ['planned_stop'],
  affectsOee: false,
  canStartManually: true
}
```

The operator starts and closes a planned stop. Because `affectsOee=false`, OEE subtracts
the stop from both `effectiveRunTimeMs` and `oeeEligibleTimeMs` if it intersects a started
job order interval, so the stop remains visible without reducing availability percentage.

### Scheduled Lunch Break

Lunch is modeled as a planned stop schedule that creates planned stops.

Use the same reason flag policy as other planned breaks when lunch should be excluded from
OEE denominator instead of treated as availability loss.

### Repeatable Needs Break

A repeatable operator break, such as a needs break, smoking break, or quick restroom break,
is modeled as a `PlannedStopTemplate`.

When the operator starts the template:

- create a new active `PlannedStop` occurrence immediately,
- set planned times from the current time and the template default duration,
- close that occurrence when the operator returns,
- keep the template available for the next use.

Do not keep a placeholder planned stop with arbitrary future `plannedStartAt` and
`plannedEndAt` open just so the operator can reuse it later.

### Planned Stop Outside Job Order Time

If a planned stop overlaps time without a started job order:

- only the portion intersecting started job order execution can affect OEE,
- the portion outside job order execution remains stored for audit/operations, but it does
  not reduce denominator or create availability loss.

### Planned Stop Overruns Planned End

If a planned stop remains active after `plannedEndAt`:

- the planned interval must count only through `plannedEndAt` unless an authorized user
  extends the planned window,
- do not open an `UnplannedStop` from clock time alone,
- if the next run-mode sample is still `< 1` and no active planned stop covers that sample
  time, open an `UnplannedStop` through the `Run Mode Opens Unplanned Stop` rule,
- preserve the real `actualEndAt` for audit, but split planned and unplanned OEE effects.

### No Job Order

If machine runs without an active job order:

- do not calculate OEE for that time,
- include a diagnostic such as `work_center_running_without_job_order` when an API
  response needs to explain why output exists without OEE context.

This is a diagnostic/runtime context path, not a stop-opening gate.

If machine stops without an active job order:

- still open/maintain `UnplannedStop` according to the `Run Mode Opens Unplanned Stop` and
  `Run Mode Closes Unplanned Stop` rules,
- do not calculate OEE for the portion that does not intersect started job order
  execution,
- later OEE calculation clips the stop to any started job order intervals it overlaps.

### Overlapping Stop Records

Prevent more than one active planned stop and more than one open unplanned stop per work
center.

When creating scheduled/manual planned stops while an unplanned stop is open, use the
`Planned Stop Start Rule`. Do not leave planned and unplanned intervals overlapping in OEE
calculation for the same work center.

## Implementation Checklist

### Reason Policy Validation

Reason creation and update must validate usage and OEE behavior:

- `usages` must contain at least one usage value.
- `code` and `name` must be unique.
- Stop-only controls such as `canStartManually`, `canBeScheduled`, and
  `canConvertFromUnplanned` apply only when `usages` includes `planned_stop` or
  `unplanned_stop`.
- `affectsOee=true` is the default for customer-created stop and scrap reasons.
- The system-default `MICRO_STOP` reason, planned non-production reasons such as lunch or
  tea break, and informational scrap reasons may use `affectsOee=false`.
- A reason can be updated after use. OEE calculations use the current reason policy at
  request time, so changing `affectsOee` can intentionally change historical OEE results.
- `isSystemDefault=true` reasons are immutable. Reject update, delete, deactivate, rename,
  recode, usage changes, and OEE behavior changes for these records.
- `MICRO_STOP` must have exactly `usages=['unplanned_stop']` and `affectsOee=false`.

### Derived Unplanned State

Unplanned stop list filters must derive state from fields instead of storing `status`:

- `state=open`: `endAt == null`.
- `state=closed`: `endAt != null` and `convertedToPlannedStopId` is missing.
- `state=converted`: `convertedToPlannedStopId` exists and `endAt != null`.

### Converted Stop Calculation

OEE tests must cover converted unplanned stops:

- converted unplanned interval overlaps a job order only partially,
- converted unplanned interval starts outside and ends inside a job order,
- converted unplanned interval starts inside and ends outside a job order,
- linked planned stop fully covers the converted interval,
- linked planned stop only partially covers the converted interval,
- overlapping planned and converted intervals are unioned before aggregation.

The converted unplanned interval must use the linked planned stop reason flags and must
never be counted as an independent unplanned availability loss.

### OEE Reason Policy Tests

OEE calculation tests must cover current reason `affectsOee` behavior and the immutable
`MICRO_STOP` exception:

- Stop with `affectsOee=true`: reduce `effectiveRunTimeMs`, keep `oeeEligibleTimeMs`.
- Stop with `affectsOee=false`: reduce both `effectiveRunTimeMs` and
  `oeeEligibleTimeMs`.
- Stop with no reason: treat as `affectsOee=true`.
- `MICRO_STOP`: exclude from `calculationStops`, do not reduce `effectiveRunTimeMs`, do
  not reduce `oeeEligibleTimeMs`, and do not split `productionRunWindows`.
- Scrap with `affectsOee=true`: reduce quality through `oeeAffectingScrap`.
- Scrap with `affectsOee=false`: return as `excludedScrap` and do not reduce quality.
- Updating a reason after historical records exist changes the next on-demand OEE response.

Stop cases must include at least one stop entirely inside a job order and one stop crossing
job order boundaries.

### Scheduled Planned Stop Tests

Scheduled planned stop tests must verify:

- scheduler materializes one `PlannedStop` per `scheduleId + workCenterId + plannedStartAt`,
- duplicate scheduler retries do not create another occurrence,
- occurrence copies `startMode` from `schedule.occurrenceStartMode`,
- automatic occurrence stays `planned` before `plannedStartAt`,
- automatic occurrence starts at `plannedStartAt`,
- late automatic scheduler run keeps planned times but starts with `actualStartAt=now`,
- manual occurrence remains `planned` until an operator or authorized API/internal command
  starts it,
- `Planned Stop Start Rule` closes any open unplanned stop before activation; retrospective
  conversion remains an explicit correction flow.

### Planned Stop Template Tests

Template tests must verify:

- starting the same template twice at different times creates two different `PlannedStop`
  occurrences,
- the template itself is not mutated or consumed by a start operation,
- generated occurrences use `source='template'`, `templateId`, `plannedStartAt=now`,
  `plannedEndAt=now + defaultDurationMs`, and `actualStartAt=now`,
- closing before `plannedEndAt` stores the real `actualEndAt` and does not create an
  unplanned overrun,
- `split_to_unplanned` creates an unplanned overrun interval from `plannedEndAt` to
  `actualEndAt`,
- `extend_planned_until_close` keeps the full actual interval under the planned stop,
- template start rejects or handles an already active planned stop through the
  `Planned Stop Start Rule`.
