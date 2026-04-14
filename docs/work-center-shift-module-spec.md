# Work-Center Shift Spec

Status: proposed

Audience: Claude

## Decision

- Shift ownership must live inside `./work-center` as a new `shift` module.
- Other services may keep `shiftId` only as a reference.
- `shiftId` is no longer an opaque reference — owner is `work-center-service`.

## Scope

This iteration must deliver:

- shift CRUD inside `work-center`
- shift runtime scheduler for `started` / `ended`
- schedule model refactor from embedded intervals to `shiftId` references
- operator auto check-out on `shift ended`
- delete reference checks across work-center and production
- production spec alignment: remove "external shift service / opaque reference" language, add sync shift validation on production write paths
- `checkoutSource` field on `OperatorCheckIn`
- `PLANT_TIMEZONE` env configuration for work-center service

This iteration must not deliver:

- archive/reactivate lifecycle
- partial ownership split between inline intervals and global shifts
- shared global config package migration

## Required model

Add `Shift` under `./work-center` with:

- `_id`
- `name`
- `startHour`
- `startMinute`
- `endHour`
- `endMinute`
- `createdBy`
- `updatedBy`
- `createdAt`
- `updatedAt`

Rules:

- `name` unique after trim, case-insensitive, globally unique across all shifts
- night shifts allowed
- `00:00` allowed as end time
- `start == end` invalid
- global shift catalog may contain overlapping shifts
- delete only if no references remain anywhere relevant

## Schedule refactor

Current model is interval-based. Replace it with shift references.

Target shapes:

- `WorkCenter.shiftIds -> ObjectId[]`
- `Calendar.weeklyPattern.day -> ObjectId[]`
- `DateException.shiftIds -> ObjectId[]`

Do not keep inline shift intervals in calendars/exceptions.

Effective schedule precedence stays:

- `DateException`
- active `Calendar`
- `WorkCenter.shiftIds`
- empty

### Effective schedule response

Uniform response shape for all cases:

- `source`: `'exception' | 'calendar' | 'default' | 'none'`
- `date`: requested date string
- `shiftIds`: resolved shift id array
- `shifts`: expanded shift objects

Concrete responses:

- exception with shifts: `{ source: 'exception', date, shiftIds: [...], shifts: [...] }`
- exception closed day: `{ source: 'exception', date, shiftIds: [], shifts: [] }`
- calendar with shifts: `{ source: 'calendar', date, shiftIds: [...], shifts: [...] }`
- calendar closed day: `{ source: 'calendar', date, shiftIds: [], shifts: [] }`
- default fallback: `{ source: 'default', date, shiftIds: [...], shifts: [...] }`
- no definition: `{ source: 'none', date, shiftIds: [], shifts: [] }`

`shiftIds: []` means closed day. `source: 'none'` means no schedule definition exists.

## Delete constraints

`DELETE /shifts/:id` must be blocked if referenced by any of:

- `WorkCenter.shiftIds`
- `Calendar.weeklyPattern`
- `DateException.shiftIds`
- `production.QuantityAdjustment.shiftId`
- `production.ScrapEntry.shiftId`

Do not leave dangling historical references.

## Update constraints

Shift update must be blocked if changing time boundaries would make any referencing schedule invalid.

### Overlap enforcement points

Overlap must not be enforced at global shift create time. Overlap must be enforced at these assignment points:

1. `WorkCenter.shiftIds` update — new list must not contain overlapping shifts
2. `Calendar.weeklyPattern[day]` create/update — shift ids assigned to a day must not overlap
3. `DateException.shiftIds` create/update — shift ids in the exception must not overlap
4. `Shift` time update — find all `WorkCenter`, `Calendar`, and `DateException` records referencing this shift, re-check overlap in each affected assignment set

Point 4 does not require brute-force full scan. Find records referencing the updated shift, then re-run overlap validation only on those assignment sets.

Duplicate shift ids in one assignment list rejected.

### 00:00 end time normalization

For overlap and boundary calculations:

- `startMinutes = startHour * 60 + startMinute`
- `endMinutes = endHour * 60 + endMinute`
- if `endMinutes === 0` then `endMinutes = 1440` (end-of-day)
- then evaluate `start < end` (same-day) vs `start > end` (overnight)

Examples:

- `16:00-00:00` -> `960-1440` -> same-day interval, not overnight
- `22:00-06:00` -> `1320-360` -> overnight shift, two-segment overlap check

### Active shift update rules

When a shift is updated while currently active (between its started and ended boundary):

- start boundary change: does not apply to current occurrence, takes effect from next occurrence
- end boundary change to a future time: reschedule today's ended timer to the new time
- end boundary change to a past time (before now): reject with 409 (conflicts with current active occurrence)

No synthetic immediate catch-up events. No retroactive start boundary changes.

## Runtime events

Publish on `events.work_center`:

- `work_center.shift.created`
- `work_center.shift.updated`
- `work_center.shift.deleted`
- `work_center.shift.started`
- `work_center.shift.ended`

### CRUD event payloads (minimal)

- `work_center.shift.created` -> `{ shiftId }`
- `work_center.shift.updated` -> `{ shiftId }`
- `work_center.shift.deleted` -> `{ shiftId }`

### Boundary event payloads (rich)

`work_center.shift.started`:

- `shiftId`
- `name`
- `startedAt`
- `occurrenceDay`
- `startHour`
- `startMinute`
- `endHour`
- `endMinute`

`work_center.shift.ended`:

- `shiftId`
- `name`
- `startedAt`
- `endedAt`
- `occurrenceDay`
- `startHour`
- `startMinute`
- `endHour`
- `endMinute`

No `workCenterId` in boundary event payloads. Affected work center resolution is the consumer's responsibility.

### Occurrence day rule

- `occurrenceDay` means the local date of the shift start, not the end timestamp date
- `22:00-06:00` shift ending on March 11 must still use `occurrenceDay = March 10`
- exception/calendar lookup for `shift ended` must use `occurrenceDay`, not the end timestamp date
- `occurrenceDay` is a date-only value (`YYYY-MM-DD` string), not an instant

### Boundary event semantics

- `work_center.shift.started` carries `startedAt`
- `work_center.shift.ended` carries both `startedAt` and `endedAt`

## Scheduler

Global shift boundary scheduler. Not work-center-aware.

Responsibilities:

- track the `Shift` collection
- manage next `started` and `ended` boundary timers for each shift
- publish a single `work_center.shift.started` or `work_center.shift.ended` event when a boundary fires
- which work centers are affected is not the scheduler's concern

Rules:

- initialized in app bootstrap, not controllers
- rebuilt from DB on restart
- create/update/delete must update scheduler state
- delete cancels future timers
- no missed-event backfill after downtime
- restart must not create duplicate timers
- update must reschedule cleanly
- deleting a shift near boundary time must not emit duplicate end/start events

## Operator behavior

`work_center.shift.ended` must trigger auto check-out for open operator check-ins on work centers effectively scheduled for that shift occurrence.

### Auto check-out flow

1. `work_center.shift.ended` event published (single event, not per-work-center)
2. consumer receives event with `shiftId` and `occurrenceDay`
3. consumer resolves affected work centers using schedule precedence (exception > calendar > default)
4. for each affected work center, auto-check-out all open operator check-ins
5. emit `work_center.operator.checked_out` for each closed check-in

Implementation direction:

- consume `work_center.shift.ended` in `./work-center/src/jobs/subscribers.ts`
- resolve affected work centers with schedule precedence
- call operator service logic per affected work center

This handling must be idempotent.

### Multi-work-center check-in

- same operator can be active in multiple work centers simultaneously
- auto check-out is per-work-center, not per-operator
- if only one work center's shift ends, only that work center's check-in closes
- operator's active check-ins in other work centers remain open

### `checkoutSource` field

Add `checkoutSource` to `OperatorCheckIn` model:

- allowed values: `manual | shift_boundary`
- `manual`: user-triggered check-out
- `shift_boundary`: auto check-out caused by shift end

`checkoutSource` must be included in `work_center.operator.checked_out` event payload.

Frontend contract:

- `work_center.shift.ended` is an internal coordination event, not the primary UI event
- frontend should primarily react to `work_center.operator.checked_out` (which now carries `checkoutSource`)
- frontend interprets operator events in `operatorId + workCenterId` context, not operatorId alone
- do not force JWT logout, cookie clearing, or session destruction on shift end
- shift end closes operator presence only

### Check-in shiftId filtering

- auto check-out filters by work center's effective schedule, not by individual check-in record's `shiftId`
- check-in records with `shiftId: null` in an affected work center are also checked out

## Timezone

- `PLANT_TIMEZONE` env variable is the source of truth for plant-local time
- validated in `work-center/src/config/index.ts`
- scheduler boundary calculations use `PLANT_TIMEZONE`
- `occurrenceDay` derived using `PLANT_TIMEZONE`
- do not rely on server system timezone
- no shared config package migration in this iteration; each service validates its own env

### Instant vs date-only

- instants (`startedAt`, `endedAt`, `checkedInAt`, `checkedOutAt`, `validFrom`, `validTo`): ISO 8601 UTC with trailing `Z` over wire, `Date` in MongoDB
- date-only values (`occurrenceDay`, exception date, effective schedule request date): `YYYY-MM-DD` string
- `DateException.localDate` should be converted from `Date` to date-only `YYYY-MM-DD` string in this refactor

## API

Minimum routes:

- `GET /shifts`
- `GET /shifts/:id`
- `POST /shifts`
- `PATCH /shifts/:id`
- `DELETE /shifts/:id`

Permissions for now:

- read routes use `readSchedules`
- write routes use `writeSchedules`

## Cross-service contracts

### Production service

- `QuantityAdjustment.shiftId` and `ScrapEntry.shiftId` are no longer opaque references
- production create/update must validate shift existence via internal API call to work-center service
- shift not found returns validation/business error
- `DELETE /shifts/:id` checks `production.QuantityAdjustment.shiftId` and `production.ScrapEntry.shiftId` references before allowing deletion

### Internal API

- work-center service exposes shift existence check for production service
- production service exposes shift reference check for work-center service delete guard

### Production spec updates required

- remove "external shift service" and "opaque reference" language
- update `shiftId` ownership to `work-center-service` shift module
- add synchronous shift validation requirement on `QuantityAdjustment` and `ScrapEntry` create/update

## Edge cases

### Time / overlap

- day shift + night shift overlap
- two night shifts overlap across midnight
- end `00:00` treated as end-of-day (1440 minutes) in overlap checks
- duplicate shift ids in one assignment list rejected
- updating one shift must not silently break many schedules
- `16:00-00:00` is same-day, not overnight

### Schedule precedence

- exception with empty array means closed day and overrides calendar/default
- exception with explicit shifts means only that set applies
- calendar day with empty array means closed day
- fallback to `WorkCenter.shiftIds` only when no exception and no active calendar match

### Occurrence date

- `22:00-06:00` shift ending on March 11 must still use `occurrenceDay = March 10`
- exception/calendar lookup for `shift ended` must use `occurrenceDay`, not the end timestamp date

### Scheduler

- restart must not create duplicate timers
- delete must cancel future timers
- update must reschedule cleanly
- deleting a shift near boundary time must not emit duplicate end/start events
- active shift end boundary change to future time reschedules today's timer
- active shift end boundary change to past time is rejected with 409

### Operator auto check-out

- unrelated work centers must not be touched
- closed-day exception must prevent action
- repeated processing of same ended event must not fail (idempotent)
- same operator active in two work centers, only one shift ends: only that work center's check-in closes
- check-in records with `shiftId: null` in affected work center are still checked out
- frontend infers shift-end-driven removal from `checkoutSource: 'shift_boundary'` in operator check-out event

## Implementation status

Implemented on local `main`:

- `shift` module exists inside `work-center`
- schedule model uses `shiftIds` references instead of embedded shift intervals
- `DateException.localDate` is a date-only `YYYY-MM-DD` string
- overlap validation covers work-center default shifts, calendar days, date exceptions, and shift time updates
- operator flow reacts to `work_center.shift.ended`
- event catalog includes shift CRUD and boundary events
- bootstrap starts the shift scheduler and startup reconciliation
- `production` shift ownership references are aligned to `work-center-service`
- `OperatorCheckIn.checkoutSource` exists with `manual | shift_boundary`
- `PLANT_TIMEZONE` is configured in `work-center`
- effective schedule response uses the uniform `{ source, date, shiftIds, shifts }` shape

## Expected files to change

- `./work-center/src/modules/shift/*`
- `./work-center/src/core/loaders/express.ts`
- `./work-center/src/core/loaders/mongoose.ts`
- `./work-center/src/config/index.ts`
- `./work-center/src/jobs/events.ts`
- `./work-center/src/jobs/subscribers.ts`
- `./work-center/src/modules/schedule/*`
- `./work-center/src/modules/operators/*`
- `./work-center/src/modules/work-center/*`
- `./work-center-spec.md`
- `./docs/production-service-spec.md`

## Minimum tests

- shift create/update/delete
- unique name validation (global, case-insensitive)
- invalid time validation (`start == end`)
- overlap validation for default shifts, calendar days, exceptions
- overlap validation on shift time update (affected assignment sets)
- delete blocked by references (work-center + production)
- update blocked when referenced schedules become invalid
- active shift update: future end reschedule, past end reject (409), start change next occurrence
- effective schedule precedence (uniform response shape)
- `00:00` end time normalization in overlap checks
- started/ended scheduler behavior with fake timers
- delete updates scheduler state
- idempotent auto check-out on `shift ended`
- multi-work-center operator check-in preserved during auto check-out
- operator check-out event emitted with `checkoutSource = shift_boundary`
- `checkoutSource = manual` on user-triggered check-out

## Important anti-goals

- no archive status for shifts
- no dangling `shiftId` references
- no per-work-center boundary event fan-out
- no shared global config package migration
- no `system` value for `checkoutSource` until concrete use case exists
