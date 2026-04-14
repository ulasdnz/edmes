# Productivity-Service Specification

## Summary

The Productivity service owns OEE, productivity, quality aggregation, and downtime
classification for Aimes core MES.

The first version must support a solid core MES flow:

- collect machine signals from Telemetry,
- use Work Center calendars to understand expected operating time,
- use Production job order executions as the production context,
- calculate OEE/productivity for a requested time range,
- create and manage planned and unplanned stop records,
- keep the public API simple for the frontend.

## Design Principles

1. The frontend asks for OEE directly.

   There is no required public "time-context" call before OEE. The frontend should call:

   ```http
   GET /api/v1/oee?workCenterId=...&from=...&to=...&groupBy=...
   ```

2. Work Center owns calendars.

   Work Center answers: "When is this work center expected to operate?"

3. Production owns job orders.

   Production answers: "Which job orders were executing in this time range?"

4. Telemetry owns raw machine signals.

   Telemetry answers: "What did the machine signals do in this time range?"

5. Productivity owns OEE and downtime classification.

   Productivity combines operating windows, job order executions, planned stops,
   unplanned stops, quantities, scrap, and historian summaries.

6. Calendar and planned stops are different concepts.

   Calendar defines when the work center is normally expected to work. Planned stops
   define deliberate stops during otherwise expected operating windows.

7. Deployment scoping stays simple.

   Aimes runs as one on-premises instance per factory installation. Do not add
   deployment-scope fields to domain models, indexes, or API contracts.

## Service Ownership

### Work Center

Owns:

- work centers,
- shifts,
- weekly calendars,
- date exceptions,
- default shift assignment,
- effective operating window resolution.

Required internal contract:

```http
GET /internal/v1/operating-windows?workCenterId=...&from=...&to=...
```

This endpoint should return resolved operating windows for the range. It should not try to
calculate OEE, job orders, downtime, or productivity.

Implementation prerequisite: this exact range-resolved internal endpoint must be exposed
by Work Center before Productivity depends on it.

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
GET /internal/v1/job-order-executions?workCenterId=...&from=...&to=...
```

This should return job orders whose actual execution window intersects the requested
range. A still-open job order should use the request `to` as its temporary end for
calculation.

Implementation prerequisite: this exact execution-window internal endpoint must be exposed
by Production before Productivity depends on it.

Aimes Production already blocks active/overlapping job orders on the same work center.
Productivity should rely on that invariant and does not need to add a duplicate
overlapping job order guard.

### Telemetry

Owns:

- tag definitions,
- run mode, counter, and speed historian data,
- produced count summaries,
- speed averages,
- state durations.

Productivity uses Telemetry historian endpoints for calculation. Every tag retains full
history in Telemetry, so run mode transitions between polls are never lost and past
downtime can be recalculated after calendar/job order corrections.

Run mode detection uses the Work Center tag binding as the source of truth:

- Work Center provides the target work center's `runModeTagId`.
- Productivity consumes `tag.value.recorded` events from the Telemetry stream and handles
  only events whose `tagId` matches a configured run mode tag. The payload includes
  `behavior` (`counter | speed | binary`) so subscribers can interpret the sample without
  re-fetching the tag.
- On startup/restart, Productivity should fetch the latest historian sample from Telemetry
  via `GET /internal/v1/historian/:tagId/latest` and reconstruct any missed transitions
  via `GET /internal/v1/historian/:tagId/state-durations` so it can reconcile an
  already-stopped or already-running work center.
- Productivity should not subscribe directly to MQTT topics.

### Productivity

Owns:

- OEE API,
- downtime reasons,
- planned stops,
- unplanned stops,
- planned stop schedules,
- planned/unplanned/out-of-schedule stop classification,
- OEE calculation rules.

## Work Center Calendar Changes

The current Aimes effective schedule precedence is correct:

```text
date exception > calendar weekly pattern > default workCenter.shiftIds > none
```

However, the current single-day `GET /work-centers/:workCenterId/schedule?date=YYYY-MM-DD`
response is not enough for OEE. It returns source, shift ids, and shifts for one day, but
Productivity needs resolved operating windows for a full range.

### Required Calendar Improvements

#### DateException

The current `DateException` model only has `shiftIds`. That makes an exception with
`shiftIds: []` ambiguous. It may mean a closed day, but the meaning is implicit.

Add explicit mode fields:

```ts
DateException {
  workCenterId: ObjectId
  localDate: string
  mode: 'closed' | 'replace' | 'add'
  shiftIds?: ObjectId[]
  customWindows?: Array<{
    startHour: number
    startMinute: number
    endHour: number
    endMinute: number
  }>
  reason?: 'holiday' | 'overtime' | 'special_shift' | 'other'
  note?: string
}
```

Meaning:

- `closed`: no operating time for that local date.
- `replace`: replace the normal calendar/default assignment for that date.
- `add`: add extra operating time on top of the normal calendar/default assignment.

Migration rule:

- Existing exception with `shiftIds: []` should become `mode: 'closed'`.
- Existing exception with non-empty `shiftIds` should become `mode: 'replace'`.

#### Time Handling

All calendar resolution must use the plant timezone configured for the installation.

- Public API `from` and `to` values are instants.
- `localDate` is used only for resolving calendar/exception rules in the plant timezone.
- Operating windows are returned as ISO instants after local schedule resolution.
- Overnight shifts belong to the local date where the shift starts.
- Date exception `customWindows` must pass the same overlap validation as shifts.
- `DateException(mode='add')` must not overlap existing operating windows for the same
  work center and local date. Reject overlapping add windows instead of merging silently.

#### Operating Windows

Work Center should expose resolved operating windows for a range:

```ts
type OperatingWindowsResponse = {
  workCenterId: string
  from: string
  to: string
  operatingWindows: Array<{
    startAt: string
    endAt: string
    source: 'calendar' | 'default' | 'exception'
    shiftId?: string
    calendarId?: string
    exceptionId?: string
    exceptionMode?: 'replace' | 'add'
  }>
  diagnostics: Array<{
    type: 'no_schedule' | 'closed_day'
    startAt: string
    endAt: string
    source: 'none' | 'exception'
    exceptionId?: string
    reason?: string
    note?: string
  }>
}
```

Important behavior:

- Return only expected operating windows in `operatingWindows`.
- Do not return every non-working gap as a window.
- Use `diagnostics` for meaningful non-working explanations such as `closed_day` and
  `no_schedule`.
- If a date exception is `closed`, do not return operating windows for that local date.
- If there is no calendar/default/exception for a range, return `no_schedule`
  diagnostics so Productivity can apply its fallback policy.

### Breaks as Planned Stops

Tea breaks, needs breaks, cleaning, and operator-triggered pauses are deliberate stops
during an expected operating window. They should be modeled as planned stops or planned
stop schedules. This keeps the calendar simple:

- Calendar: when the work center is expected to operate.
- Planned stop: why expected operation intentionally stopped.

If a plant has a fixed lunch break every day, model it as a scheduled planned stop.
If an operator starts a tea break based on actual production conditions, model it as a
manual planned stop.

## Productivity Time Rules

### Base Expected Time

For each OEE query:

```text
baseExpectedTime = jobOrderExecutions intersect operatingWindows
```

If Work Center returns `no_schedule` for the requested range:

```text
baseExpectedTime = jobOrderExecutions
```

If the customer has not configured a schedule yet, a running/open job order is treated as
expected production time.

### No Schedule Policy

When no schedule exists:

- still calculate OEE from job order execution time,
- still create unplanned stops from run mode stops inside the job order execution
  window,
- include a diagnostic warning in the OEE response:

```ts
{
  code: 'calendar_missing_job_order_fallback',
  message: 'No calendar found; job order execution time was used as expected production time.'
}
```

### Calendar Exists But Work Is Outside It

When a calendar exists and a job order is open outside the operating windows:

- do not create an OEE-affecting unplanned stop for stopped time outside the windows,
- do not include outside-window time in availability/productivity denominator,
- keep machine-signal-derived stop/run observations as `out_of_schedule` events or
  diagnostics so the data is not lost,
- when the customer adds overtime through a `DateException(mode='add')`, historical
OEE can be recalculated from historian data and existing stop observations.

### Closed Day

If a date exception marks the day as `closed`:

- no expected time is produced for that day,
- open job orders do not create OEE denominator for that day,
- stopped machine state does not create OEE-affecting unplanned stop time,
- running machine state may be reported as out-of-schedule production/run.

## Downtime Domain Model

### DowntimeReason

```ts
DowntimeReason {
  _id: ObjectId
  name: string
  kind: 'planned' | 'unplanned' | 'both'
  oeeEffect: 'excluded' | 'availability_loss'
  canStartManually: boolean
  canBeScheduled: boolean
  canConvertFromUnplanned: boolean
  isActive: boolean
  createdBy: ObjectId
  updatedBy: ObjectId
  createdAt: Date
  updatedAt: Date
}
```

Meaning:

- `planned`: can be used for planned stops only.
- `unplanned`: can be used for unplanned stops only.
- `both`: can be used in either flow.
- `excluded`: remove the interval from OEE denominator.
- `availability_loss`: keep the interval in denominator and count it as availability loss.

Stop records store `reasonId`. OEE resolves `oeeEffect` from the current
`DowntimeReason` at calculation time. Reasons referenced by stops must not be
hard-deleted; mark them inactive instead.

Examples:

- Lunch break: `planned`, `excluded`, manually startable or schedulable.
- Tea break: `planned`, `excluded`, manually startable.
- Planned cleaning: `planned`, `excluded` or `availability_loss` depending on plant rule.
- Machine stopped, no reason yet: unplanned stop with no reason.
- Minor stop: `unplanned`, `availability_loss`.

### PlannedStopSchedule

Recurring or scheduled planned stops are separate from realized planned stops.

```ts
PlannedStopSchedule {
  _id: ObjectId
  workCenterIds: ObjectId[]
  reasonId: ObjectId
  plannedOwnerId: ObjectId
  name: string
  description?: string
  recurrence: {
    frequency: 'daily' | 'weekly' | 'monthly'
    daysOfWeek?: Array<
      'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
    >
    startHour: number
    startMinute: number
  }
  plannedDurationMs: number
  createBeforeStartMs: number
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

When a schedule occurrence enters its `createBeforeStartMs` window, Productivity creates
a `PlannedStop` occurrence. Schedule definitions for the same work center should be
validated so their generated planned windows do not overlap.

### PlannedStop

One planned stop record represents one manual, scheduled, or converted planned stop.

```ts
PlannedStop {
  _id: ObjectId
  workCenterId: ObjectId
  reasonId: ObjectId
  plannedOwnerId: ObjectId
  source: 'manual' | 'scheduled' | 'converted'
  status: 'planned' | 'active' | 'closed' | 'cancelled'

  plannedStartAt: Date
  plannedEndAt: Date
  actualStartAt?: Date
  actualEndAt?: Date
  scheduleId?: ObjectId

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

### UnplannedStop

One unplanned stop record represents one run-mode or manual unplanned stop.

```ts
UnplannedStop {
  _id: ObjectId
  workCenterId: ObjectId
  reasonId?: ObjectId
  source: 'run_mode' | 'manual'
  status: 'open' | 'closed' | 'converted'

  startAt: Date
  endAt?: Date
  convertedToPlannedStopId?: ObjectId

  operatorId?: ObjectId
  closedBy?: ObjectId
  approvedAt?: Date
  description?: string
  props: Record<string, string | number | boolean>

  createdBy?: ObjectId
  updatedBy?: ObjectId
  createdAt: Date
  updatedAt: Date
}
```

Indexes:

```ts
{ workCenterId: 1, status: 1 } // unique, partial: { status: 'open' }
{ workCenterId: 1, startAt: 1, endAt: 1 }
{ reasonId: 1 }
```

There must be at most one active planned stop and at most one open unplanned stop per work
center. Planned and unplanned stops should not overlap in OEE calculation; planned start
rules below define how to close or convert unplanned stops before a planned stop becomes
active.

## Downtime Runtime Rules

### Run Mode Opens Unplanned Stop

When run mode is below the configured running threshold:

- if the current time is inside expected time, open an `UnplannedStop` with
  `source='run_mode'`,
- if the current time is outside expected time but a calendar exists, open or update an
  out-of-schedule observation instead of an OEE-affecting unplanned stop,
- if no schedule exists, use the job order fallback and open an unplanned stop inside
  the job order execution window.

Use the Telemetry event `occurredAt` as the `UnplannedStop.startAt`. Ignore run mode events
whose `occurredAt` is older than the last processed run mode timestamp for that work
center.

Use the existing Work Center action settings where possible for thresholds such as
micro-stop and uncaused downtime confirmation.

### Run Mode Closes Unplanned Stop

When run mode returns to running:

- close the open `UnplannedStop`,
- classify very short stops according to the configured micro-stop/short-stop rule,
- leave the stop reason empty if the operator has not selected a reason yet.

Close with an atomic condition such as `workCenterId + status='open'`. If no open stop
matches, treat the close as already handled.

### Planned Stop Starts While Unplanned Is Open

When a planned stop starts and there is an open unplanned stop on the same work center:

1. Close the open `UnplannedStop` at the planned stop `actualStartAt`.
2. Mark the `PlannedStop` as `active`.
3. Do not allow the two intervals to overlap in OEE calculation.

For retrospective correction, provide a conversion action:

```http
POST /api/v1/unplanned-stops/:id/convert-to-planned
```

This should create a `PlannedStop` and mark the original `UnplannedStop` as converted:

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

The conversion is allowed only if the selected reason has `canConvertFromUnplanned=true`.
Converted `UnplannedStop` records must be excluded from OEE interval aggregation to avoid
double counting.

### Planned Stop Ends

When a planned stop ends:

- close the active `PlannedStop`,
- if the machine is still stopped and current time is expected time, open a new unplanned
  stop from the planned stop `actualEndAt`,
- if the machine is outside expected time, do not open an OEE-affecting unplanned stop.

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
non-cancelled `PlannedStop` for the same work center. Use the normal interval overlap rule:
`new.plannedStartAt < existing.plannedEndAt && new.plannedEndAt > existing.plannedStartAt`.

### Scheduled Planned Stop Occurrences

The scheduler should create one `PlannedStop` per work center and occurrence window. It
must use the `scheduleId + workCenterId + plannedStartAt` unique index and treat duplicate
key errors as an already-created occurrence. If an occurrence is created late, keep the
original `plannedStartAt`/`plannedEndAt` and set `actualStartAt` to the actual start time
when the stop becomes active.

### Backdated Correction

Allow authorized users to correct a past stop interval by:

- assigning a reason,
- converting an unplanned stop to a planned stop if the reason allows it,
- creating a closed planned stop interval for a past period if the plant explicitly
  permits backdated correction.

Any correction should be auditable and should trigger recalculation for affected OEE
queries if cached results exist.

## OEE Calculation Rules

### Inputs

For a query:

```http
GET /api/v1/oee?workCenterId=...&from=...&to=...&groupBy=none|day|shift|jobOrder
```

Productivity loads:

- operating windows from Work Center,
- job order executions from Production,
- product standards from Production,
- quantity adjustments and scrap entries from Production,
- run mode, production counter, and speed summaries from Telemetry,
- planned stops and unplanned stops from Productivity.

For calculation, Productivity normalizes `PlannedStop` and `UnplannedStop` records into
internal downtime intervals. `converted` unplanned stops are skipped because their OEE
effect is represented by the linked `PlannedStop`.

For a `PlannedStop`, actual OEE should use the realized interval when present, capped by
the planned window unless an authorized user extends it: start at
`actualStartAt ?? plannedStartAt`; end at `actualEndAt` if present, otherwise the earlier of
the query end/current time and `plannedEndAt`; then cap at `plannedEndAt`. A future
`PlannedStop` with no `actualStartAt` must not reduce current actual OEE. If a planned stop
starts late, the missed planned portion should not be counted as downtime.

### Availability

```text
denominator = baseExpectedTime - plannedStop(oeeEffect='excluded')
availabilityLoss = unplannedStop + plannedStop(oeeEffect='availability_loss')
runningTime = denominator - availabilityLoss
availability = runningTime / denominator
```

Notes:

- out-of-schedule observations do not affect denominator or availability loss.
- Planned stops outside expected time do not affect OEE.
- Downtime intervals must be clipped to the query range and expected windows.
- Overlapping planned/unplanned intervals on the same work center should be prevented. If
  historical overlap is found, planned intervals take precedence, unplanned intervals are
  split or clipped deterministically, and the response should include a diagnostic warning.

### Productivity

For count-based work centers:

```text
actualOutput = gross produced count from production counter + quantity adjustments
idealOutput = runningTime minutes * productStandard.idealOutputPerMinute
productivity = actualOutput / idealOutput
```

For speed-based work centers:

```text
actualRate = historian speed average over running windows
idealRate = productStandard.idealSpeed
productivity = actualRate / idealRate
```

Productivity uses `runningTime`, not the availability denominator, so downtime is not
penalized once in availability and again in productivity. Counter/speed samples outside
running windows must not inflate productivity. Running windows are the denominator
windows after subtracting downtime intervals that count as availability loss.

### Quality

```text
total = gross produced count + quantity adjustments
scrap = scrap entries
good = total - scrap
quality = good / total
```

The production counter is treated as a gross count from the field signal. Scrap is entered
separately by Production and subtracted only in the quality calculation.

If no total production exists, quality should return zero or null according to the API
response convention chosen for the service. The convention must be consistent across all
OEE factors.

### OEE

```text
oee = availability * productivity * quality
```

All factor percentages should be capped at sensible bounds for the response layer, but
the calculation should preserve raw values in diagnostics when needed for debugging.

## Public API

### OEE

```http
GET /api/v1/oee?workCenterId=...&from=...&to=...&groupBy=none|day|shift|jobOrder
GET /api/v1/oee?workCenterIds=...&from=...&to=...&groupBy=workCenter
```

Use query parameters instead of nesting OEE under `/work-centers/:id` because OEE is a
reporting resource and often needs multi-work-center queries.

Response shape:

```ts
{
  data: {
    from: string
    to: string
    groupBy: string
    items: Array<{
      workCenterId: string
      from: string
      to: string
      jobOrderId?: string
      shiftId?: string
      availability: {
        percentage: number
        denominatorMs: number
        runningMs: number
        lossMs: number
      }
      productivity: {
        percentage: number
        actualOutput?: number
        idealOutput?: number
      }
      quality: {
        percentage: number
        good: number
        total: number
        scrap: number
      }
      oee: {
        percentage: number
      }
    }>
    diagnostics: Array<{
      code: string
      workCenterId?: string
      from?: string
      to?: string
      message: string
    }>
  }
}
```

### Downtime Reasons

```http
GET /api/v1/downtime-reasons
POST /api/v1/downtime-reasons
GET /api/v1/downtime-reasons/:id
PATCH /api/v1/downtime-reasons/:id
DELETE /api/v1/downtime-reasons/:id
```

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

### Unplanned Stops

```http
GET /api/v1/unplanned-stops?workCenterId=...&from=...&to=...&status=...
POST /api/v1/unplanned-stops
POST /api/v1/unplanned-stops/:id/close
POST /api/v1/unplanned-stops/:id/convert-to-planned
PATCH /api/v1/unplanned-stops/:id
```

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
GET /internal/v1/operating-windows?workCenterId=...&from=...&to=...
GET /internal/v1/work-centers/:id
```

The work center response must include productivity mode and tag bindings for the target
work center.

### Production

```http
GET /internal/v1/job-order-executions?workCenterId=...&from=...&to=...
GET /internal/v1/product-standards?workCenterId=...&productId=...&at=...
GET /internal/v1/quantity-adjustments?workCenterId=...&from=...&to=...
GET /internal/v1/scrap-entries?workCenterId=...&from=...&to=...
```

### Telemetry

Use existing or equivalent historian summary endpoints:

```http
GET /internal/v1/historian/:tagId/produced?from=...&to=...
GET /internal/v1/historian/:tagId/speed-avg?from=...&to=...
GET /internal/v1/historian/:tagId/state-durations?from=...&to=...
GET /internal/v1/historian/:tagId/latest
```

Productivity should pass clipped denominator windows where possible, or request raw
summaries per window and aggregate locally.

The `latest` endpoint returns the last persisted historian sample for the tag
(`{ tagId, value, occurredAt }`), or `null` if the tag has no samples yet. It is used for
startup/current-status checks but is not the source of truth for historical OEE
reconstruction — Productivity must reconstruct missed intervals from `state-durations`,
which segments binary tags from historian samples and uses the sample preceding `from` as
the baseline. `state-durations` is the authoritative endpoint for run mode stop
reconstruction.

## Events

Events use Redis Stream name and event type separately.

Productivity should consume:

- stream `events.production`, types `job_order.started`, `job_order.ended`,
  `job_order.updated`, `job_order.deleted`, `quantity_adjustment.created`,
  `quantity_adjustment.updated`, `quantity_adjustment.deleted`, `scrap_entry.created`,
  `scrap_entry.updated`, `scrap_entry.deleted`, `product_standard.created`,
  `product_standard.updated`, `product_standard.deleted`;
- stream `events.work_center`, types `work_center.schedule.changed`,
  `work_center.shift.created`, `work_center.shift.updated`, `work_center.shift.deleted`,
  `work_center.updated`;
- stream `events.telemetry`, type `tag.value.recorded` for run mode, production counter,
  and speed tags bound to relevant work centers.

Productivity should emit on stream `events.productivity`:

- `planned_stop.created`
- `planned_stop.started`
- `planned_stop.closed`
- `planned_stop.updated`
- `unplanned_stop.opened`
- `unplanned_stop.closed`
- `unplanned_stop.updated`
- `unplanned_stop.converted`
- `planned_stop_schedule.created`
- `planned_stop_schedule.updated`
- `planned_stop_schedule.deleted`

The first implementation may calculate OEE at query time. When caching is used,
calendar/job order/stop/telemetry changes must invalidate the affected range.

## Edge Cases

### Job Order Open Across Multiple Days

If a job order stays open for two days and the work center has one shift per day:

- only the intersections between job order execution and operating windows count as
  expected time,
- time between shifts is not unplanned stop time,
- time between shifts does not affect productivity denominator,
- if there is no schedule at all, job order fallback applies and the open job order
  window is treated as expected time.

### Operator Starts Tea Break

Tea break should be a planned stop reason with:

```ts
{
  kind: 'planned',
  oeeEffect: 'excluded',
  canStartManually: true
}
```

The operator starts and closes a planned stop. OEE excludes the stop from the
denominator if it intersects expected time.

### Scheduled Lunch Break

Lunch should be modeled as a planned stop schedule that creates planned stops.

This keeps the same OEE behavior for fixed lunch and manually started breaks.

### No Schedule Configured

If no calendar/default schedule exists:

- use job order execution time as expected time,
- create an unplanned stop when run mode stops inside the job order execution,
- return a diagnostic warning.

### Schedule Exists But Overtime Is Missing

If the machine runs or stops outside operating windows because overtime was not entered:

- do not include the outside-window time in OEE,
- store or expose out-of-schedule observations,
- when an authorized user adds a `DateException(mode='add')` for overtime, recalculate
  OEE from historian data and stop records.

### Closed Day Exception

If the work center has `DateException(mode='closed')`:

- no expected time is created for that day,
- job orders open during that day do not create OEE denominator,
- stopped machine state does not become OEE-affecting unplanned stop time.

### Planned Stop Outside Expected Time

If a planned stop overlaps off-shift time:

- only the portion intersecting expected time can affect OEE,
- the off-shift portion should not reduce denominator or create loss.

### Planned Stop Overruns Planned End

If a planned stop remains active after `plannedEndAt`:

- the planned interval should count only through `plannedEndAt` unless an authorized user
  extends the planned window,
- if the machine is still stopped and expected time continues, open an `UnplannedStop`
  from `plannedEndAt`,
- preserve the real `actualEndAt` for audit, but split planned and unplanned OEE effects.

### No Job Order But Machine Running

If machine runs without an active job order:

- do not calculate OEE for that time,
- do not create a stop record,
- emit or update a work-center action such as `jobOrder` / `job_order_missing`,
- optionally expose the run as out-of-context production diagnostics.

### Overlapping Stop Records

Prevent more than one active planned stop and more than one open unplanned stop per work
center.

When creating scheduled/manual planned stops while an unplanned stop is open, use the
planned-stop-start rule above. Do not leave planned and unplanned intervals overlapping in
OEE calculation for the same work center.
