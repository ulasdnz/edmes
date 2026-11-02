# Test Scenarios: performance

> Generated: 2026-11-01 | Spec: docs/superpowers/specs/2026-11-01-run-mode-outage-design.md | Plan: docs/superpowers/plans/2026-11-01-run-mode-outage.md
> Status: READY
> Immutable after implementation starts.
>    To change: update this file, then re-run /write-scenario-tests.
> Scope: spec Testing scenarios 1-12 and the plan's Review Focus 1-5 (spec scenarios 13 and 14 are in telemetry.md), then the unit-level tests the plan lists for the same behavior. A `scenario:` or `review-focus:` line marks the one group that carries that numbered item. A `spec:` line marks a group that supports a spec rule or the other half of a scenario; `see-also:` points to such groups.
> Notation: D is the debounce `runModeDebounceMs` (60 s unless a bullet says otherwise). T0 and T1 are the machine's own times of a stopped and a running signal, E is the actual end of a planned stop. A clock time such as 10:00 is on the same day, in UTC. "Cannot answer" means the service refuses the connection, answers with a server error (5xx) or does not answer in time. The retry schedule is 1, 2, 4, 8 and 16 s between attempts, then every 30 s. A run-mode stop is an unplanned stop with source `run_mode`.

---

## RunMode.tickConfirmsAfterOutage
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> scenario: 1

### happy path
- [CRITICAL] candidate (T0, D = 60 s) whose D has run out while telemetry cannot answer, telemetry back at T0 + 10 min with the T0 stopped sample as its latest sample for the tag → the tick opens a run-mode stop with startAt = T0 (not the time telemetry came back), leaves it open, and deletes the candidate

### constraints
- [CRITICAL] D has run out and telemetry cannot answer → no stop is created and the candidate stays ("cannot answer" never means "stopped")

---

## RunMode.lateRunningSignal
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 4
> scenario: 2

### happy path
- [CRITICAL] candidate T0 = 10:00 (D = 60 s), telemetry cannot answer, running signal at T1 = 10:05 → exactly one stop [10:00, 10:05] is recorded already closed with the machine's own times, and no candidate is left

### constraints
- candidate T0 = 10:00 (D = 60 s), running signal at T1 = 10:00:20 (T1 - T0 < D) → no stop is recorded and the candidate is deleted
- [HIGH] candidate with T1 - T0 >= D but a planned stop covers T0 → no stop is recorded and the candidate is deleted

### boundaries
- T1 - T0 equals D exactly (10:00:00 to 10:01:00, D = 60 s) → the stop [T0, T1] is recorded (a stop counts when the machine stays stopped at least D)

---

## RunMode.burstAfterOutage
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 4
> scenario: 3

### edge cases
- [HIGH] signals 0@10:00, 1@10:00:20, 0@10:00:40 and 1@10:03 arrive in one burst (as after an outage), D = 60 s → exactly one stop [10:00:40, 10:03] is recorded; the first stop (20 s, shorter than D) is not, and no candidate is left

---

## RunMode.tickSeesNewerRecord
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> scenario: 4

### happy path
- [CRITICAL] candidate (T0, D = 60 s) whose D has run out, and the latest telemetry sample for the tag is newer than T0 (a signal performance has not processed yet) → the tick opens no stop and keeps the candidate

### state transitions
- [CRITICAL] the tick waited on a newer record, then the running signal arrives with T1 - T0 >= D → exactly one stop [T0, T1] is recorded (no duplicate) and the candidate is deleted
- [CRITICAL] the tick waited on a newer record, then the running signal arrives with T1 - T0 < D → no stop is recorded (no false stop) and the candidate is deleted

---

## RunMode.concurrentDecision
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> scenario: 5
> see-also: UnplannedStop.recordClosedFromRunMode, UnplannedStop.openFromRunMode (plan Task 3: the unique index behind it)

### edge cases
- [CRITICAL] the tick (the latest telemetry sample is the T0 stopped sample) and the running signal (T1 - T0 >= D) decide the same candidate at the same moment → exactly one run-mode stop with startAt = T0 exists, closed at T1, and neither writer fails (the second write counts as already recorded)

---

## RunMode.lateRunningSignalOnShortStop
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 4
> scenario: 6
> see-also: UnplannedStop.closeOnRunning (plan Task 3: the same rule at service level)

### happy path
- [CRITICAL] untouched run-mode stop (updatedBy null) opened at 10:00 through `openFromRunMode`, D = 60 s, running signal at 10:00:20 (shorter than D) → the stop is deleted and no unplanned stop remains for the work center
- [CRITICAL] run-mode stop a user has changed (updatedBy set, for example an operator gave it a reason) opened at 10:00, running signal at 10:00:20 → the stop is closed at 10:00:20 and kept, with the user's change intact

### edge cases
- [CRITICAL] candidate since 10:00, an operator opens a manual stop at 10:30, then the late running signal at 10:25 is processed → [10:00, 10:25] is recorded and the manual stop stays open (a running signal never ends a stop that started after it)
- [HIGH] untouched run-mode stop opened at 10:30 (as a planned stop's close opens one), late running signal at 10:25 → the stop is neither deleted nor closed

---

## RunMode.checkAfterPlannedStop
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> scenario: 7
> see-also: PlannedStop.closeWithoutRunMode (plan Task 6: the first half, a planned stop closing while telemetry is down)

### happy path
- [CRITICAL] pending check since E, telemetry back, its history since E shows the machine stopped at E and running again at E + 4 min → the stop [E, E + 4 min] is recorded already closed and the check is deleted
- [CRITICAL] pending check since E, the history shows the machine stopped at E and still stopped → a run-mode stop is opened at E (left open) and the check is deleted
- pending check since E, the history shows the machine running at E → no stop is created and the check is deleted

### constraints
- no debounce applies to the check: D = 60 s, the history shows the machine stopped at E and running again at E + 10 s → the stop [E, E + 10 s] is recorded
- [CRITICAL] telemetry cannot answer → no stop is created and the check stays

---

## PlannedStop.closeWithoutRunMode
> target: performance/src/modules/planned-stop/planned-stop.service.test.ts
> plan-task: 6
> spec: Decision rules 4 (the check is left); first half of the scenario carried by RunMode.checkAfterPlannedStop

### happy path
- [CRITICAL] a planned stop closes at E and telemetry cannot be reached to read the run mode → the check `{ kind: 'after_planned', since: E (ISO 8601 UTC with Z), debounceMs: 0, attempts: 0, nextAttemptAt: null }` is stored under `runmode:after-planned:{workCenterId}:{runModeTagId}` with a TTL of 25 hours, and no stop is opened at that moment
- [HIGH] work-center cannot be reached when the planned stop closes → the run-mode tag is taken from the work center's `RunModeProcessingState` (its cursor) and the check is stored for that tag

### constraints
- the run mode can be read when the planned stop closes → no check is stored (a stopped machine gets its stop opened at E, as before)
- [HIGH] a debounce candidate of the same work center and tag is pending when the check is stored → the candidate stays untouched (the check has its own key)
- neither work-center nor a cursor yields a run-mode tag → `planned_stop.run_mode_unmonitored` is logged at warn level, nothing is stored, and closing the planned stop completes normally

---

## RunMode.retrySchedule
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> scenario: 8

### state transitions
- [HIGH] telemetry keeps failing: the tick (which runs every second) asks again 1 s after the first failed attempt, then 2, 4, 8 and 16 s after the following failures, and every 30 s after that; the ticks in between skip the record without calling telemetry
- [HIGH] a decision that waits through several failed attempts and is then made → exactly one `run_mode.decision.deferred` (warn, at the first failure) and one `run_mode.decision.resolved` (info, with `waitedMs`) are logged for it; the failed attempts in between add no log line
- an after-planned check whose history cannot be read follows the same retry schedule and logs the same two lines as a candidate

### constraints
- after each failed attempt the Redis record holds `attempts` increased by one and `nextAttemptAt` (ISO 8601 UTC with `Z`) set to the attempt time plus the delay of that attempt

### edge cases
- [HIGH] a record still undecided with its `since` more than 24 hours before the tick's `now` → the record is deleted, one `run_mode.decision.abandoned` is logged at error level, and no stop is created
- a record undecided with its `since` just under 24 hours before `now` (23 h 59 min) → it is still pending and retried, and nothing is abandoned

---

## TagMap.updateWhileWorkCenterDown
> target: performance/src/jobs/tag-map.test.ts
> plan-task: 8
> scenario: 9
> see-also: RunModeMonitorsClient.list (plan Task 8: the client the refresh reads through)

### happy path
- work-center answers on `work_center.updated` and the run-mode tag changed → the new tag maps to the work center (the old tag no longer does) and the work center is reconciled
- work-center answers for a work center that is new to the map → it is mapped and reconciled
- work-center answers and the tag is unchanged → the mapping stays as it is and the work center is not reconciled again

### edge cases
- [CRITICAL] work-center cannot answer on `work_center.updated` → the old mapping stays (`workCenterForTag(oldTag)` still returns the work center, so its signals keep being processed), `syncWorkCenter` resolves without throwing (the event is acknowledged, not dead-lettered), and a full refresh is requested
- [HIGH] after that failed update work-center answers the refresh's monitor list → the mapping is replaced by the list (the new tag is mapped) and the work center is reconciled
- [HIGH] several updates fail while work-center is down → only one refresh loop runs at a time

---

## TagMap.startupWhileWorkCenterDown
> target: performance/src/jobs/tag-map.test.ts
> plan-task: 8
> scenario: 10
> see-also: RunMode.bootReconciliation (plan Task 7: the second half, telemetry down at boot)

### edge cases
- [HIGH] work-center cannot answer at startup → work centers that have a cursor are mapped from their cursors and their signals are processed, while the monitor list is retried on the retry schedule until it arrives
- [HIGH] the list arrives after some failed attempts → work centers without a cursor (never had a signal processed) are mapped and reconciled; work centers already known with an unchanged tag are not reconciled again

---

## RunMode.bootReconciliation
> target: performance/src/modules/run-mode/run-mode.reconciler.test.ts
> plan-task: 7
> spec: Errors and retries, Boot reconciliation; second half of the scenario carried by TagMap.startupWhileWorkCenterDown

### constraints
- [HIGH] telemetry cannot answer for a work center → `reconcileWorkCenter` throws (the failure is not swallowed)

### edge cases
- [HIGH] telemetry is down at boot → `startBootReconciliation` retries that work center on the retry schedule until telemetry answers, and the work center is then reconciled
- [HIGH] telemetry is down at boot → `startBootReconciliation()` returns without waiting for telemetry, so startup is not held up
- each monitored work center is retried on its own: one whose reconciliation keeps failing does not delay another that succeeds on its first attempt

---

## RunMode.decisionAcrossRestart
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> scenario: 11

### state transitions
- [CRITICAL] a candidate (D = 60 s) stored in Redis before a restart, the processor module loaded again as a fresh instance, the latest telemetry sample is the T0 stopped sample → the tick opens the stop at T0 and deletes the candidate
- [HIGH] a record with `attempts` 3 and a `nextAttemptAt` still in the future survives the restart → it is not asked before that time, then it is asked, and its attempt count continues from 3

---

## Outage.stopSurvivesTelemetryRestart
> target: e2e/src/outage.e2e.test.ts
> plan-task: 10
> scenario: 12
> see-also: TelemetryMqtt.sessionAcrossRestart (plan Task 9: the broker half)

### happy path
- [CRITICAL] D = 60 s; the machine publishes 0 at T0 over MQTT, telemetry is stopped, the machine publishes 1 at T0 + 90 s while telemetry is down, telemetry is started again (a new process id) → performance's API lists exactly one stop for the work center with startAt = T0 and endAt = T0 + 90 s, the machine's own times and not the time of the restart

---

## TelemetryMqtt.sessionAcrossRestart
> target: telemetry/src/lib/mqtt.broker.test.ts
> plan-task: 9
> spec: Broker buffering (stable client id); broker half of the scenario carried by Outage.stopSurvivesTelemetryRestart

### happy path
- [CRITICAL] against a real Mosquitto container: telemetry connects with the configured client id and disconnects, 3 QoS 1 messages are published, a new client instance (as after a restart with a new process id) connects with the same client id → all 3 messages arrive

---

## RunMode.machineClockAhead
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> review-focus: 1

### edge cases
- [HIGH] a stopped signal stamped ahead of the server clock (T0 later than the tick's `now`), D = 60 s, the latest telemetry sample is the T0 stopped sample → ticks before the server clock reaches T0 + D open no stop and keep the candidate

### boundaries
- the server clock reaches T0 + D (same candidate and telemetry as above) → the tick opens the stop at T0

---

## RunMode.telemetryHangs
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> review-focus: 2

### edge cases
- [HIGH] telemetry never answers a request → the request is cut off after 5 s and counts as "cannot answer": the record is deferred (`attempts` increased by one, `nextAttemptAt` set, one `run_mode.decision.deferred` logged) and no stop is created
- [HIGH] candidates of two work centers are due and telemetry never answers for the first one's tag → the other work center's stop is opened no later than 5 s after the tick starts

---

## TagMap.tagChangesWhilePending
> target: performance/src/jobs/tag-map.test.ts
> plan-task: 8
> review-focus: 3

### edge cases
- [CRITICAL] a work center has pending decisions (a debounce candidate and an after-planned check) for its old run-mode tag and its run-mode tag changes → both pending decisions of the old tag are deleted, so the old tag never decides for the machine
- pending decisions of work centers whose run-mode tag did not change are kept

---

## RunMode.stoppedSampleDeliveredTwice
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 4
> review-focus: 4

### edge cases
- [HIGH] the same stopped sample (0@T0) is processed twice, the second time later (stream redelivery after a crash) → exactly one candidate exists for the work center and tag, still holding the first stop time T0, and no stop is recorded

---

## RunMode.debounceChangesWhilePending
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 4
> review-focus: 5

### edge cases
- [HIGH] candidate written with D = 60 s at T0 = 10:00, the policy debounce is then set to 300 s, running signal at 10:02 → the stop [10:00, 10:02] is recorded: the candidate keeps the debounce it started with
- [HIGH] same candidate and policy change, the latest telemetry sample is the T0 stopped sample and the tick runs at T0 + 60 s → the tick opens the stop at T0 (the candidate's own D has run out; the new policy value does not apply to it)

---

## RunMode.redisErrorFailsTheSample
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 4
> spec: Crashes and restarts (a sample is acknowledged only after it is processed)

### constraints
- [CRITICAL] Redis refuses the write of a stopped sample's candidate → the sample fails, no candidate and no cursor; the redelivered sample stores the candidate
- [CRITICAL] Redis refuses the read of the candidate for a running sample → the sample fails, no stop, the cursor stays at T0 and the candidate is kept; the redelivered sample records [T0, T1]
- [CRITICAL] Redis refuses the delete of the candidate after [10:00, 10:05] was written → the sample fails; the stop exists, the cursor stays at 10:00 and the candidate is kept; the redelivered sample leaves exactly that stop and no candidate
- [HIGH] the service's Redis connection is lost while a running sample is handled → the sample fails, no stop; once Redis is back the redelivered sample records [T0, T1]

---

## RunMode.missedSamples
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 4
> spec: Decision rules 6; Crashes and restarts (a failed sample overtaken by a newer one)

Samples reach performance as telemetry publishes them, with `previousOccurredAt`; the telemetry stub answers `state-durations` from the samples it stored, as telemetry computes it.

### happy path
- [CRITICAL] 0@10:00 processed, 1@10:05 fails (Redis refuses the candidate read), 0@10:20 arrives with `previousOccurredAt` 10:05 → the stop [10:00, 10:05] is recorded, a candidate since 10:20 is stored, the cursor is at 10:20, telemetry is asked once (state-durations from 10:00 to 10:20) and one `run_mode.sample.gap_replayed` is logged (from 10:00, to 10:20, replayed 1); the redelivered 1@10:05 then changes nothing, and 1@10:25 with `previousOccurredAt` 10:20 records [10:20, 10:25]
- [CRITICAL] cursor at 0@10:00, 1@10:05 and 0@10:10 never reach performance, 1@10:15 arrives with `previousOccurredAt` 10:10 → the stops [10:00, 10:05] and [10:10, 10:15] are recorded, no candidate is left, the cursor is at 10:15 and `replayed` is 2

### constraints
- [CRITICAL] the candidate's delete fails after [10:00, 10:05] was written, then 0@10:20 arrives with `previousOccurredAt` 10:05 → no second stop starts at 10:00 and a candidate since 10:20 is stored; 1@10:25 records [10:20, 10:25]
- [HIGH] the tag's first stored sample (`previousOccurredAt` null), then a sample whose `previousOccurredAt` equals the cursor → telemetry is not asked and no `run_mode.sample.gap_replayed` is logged
- [HIGH] a sample of a tag without a cursor, whose predecessor was stored before the tag reached the map → telemetry is not asked
- [HIGH] telemetry cannot answer during the replay → the sample fails and nothing is decided for it (no stop, the candidate as it was, the cursor where it was); once telemetry answers, the redelivered sample replays the gap and records [10:00, 10:05] and [10:10, 10:15]
- [HIGH] Redis refuses the write of the second replayed sample's candidate → the sample fails, the first replayed sample keeps its stop and the cursor it advanced (10:05); the redelivered sample replays the rest

---

## UnplannedStop.recordClosedFromRunMode
> target: performance/src/modules/unplanned-stop/unplanned-stop.service.test.ts
> plan-task: 3
> spec: A late stop is written closed in one write; Decision rules 5

### happy path
- [CRITICAL] recording [T0, T1] for a work center → one document is inserted already closed (source `run_mode`, startAt = T0, endAt = T1), and the opened event and then the closed event are published
- a recorded stop of 90 s with the default micro stop threshold of 120 000 ms → its `reasonId` is the `MICRO_STOP` reason

### constraints
- [CRITICAL] the same stop (same work center and start) is recorded twice → one document remains and both calls return its `_id`
- a recorded stop longer than the micro stop threshold → it carries no `MICRO_STOP` reason
- [CRITICAL] an open manual stop exists when a closed run-mode stop is recorded → the manual stop stays open and untouched

### boundaries
- a recorded stop lasting exactly the micro stop threshold (120 000 ms) → `MICRO_STOP` reason (the rule is "no longer than the threshold")

---

## UnplannedStop.openFromRunMode
> target: performance/src/modules/unplanned-stop/unplanned-stop.service.test.ts
> plan-task: 3
> spec: Decision rules 5; Data and configuration changes (unique index on workCenterId and startAt for run-mode stops)

### constraints
- [CRITICAL] a run-mode stop with the same work center and start already exists → `openFromRunMode` returns that stop and no second document is created

---

## UnplannedStop.closeOnRunning
> target: performance/src/modules/unplanned-stop/unplanned-stop.service.test.ts
> plan-task: 3
> spec: Decision rules 2 (open unplanned stop); What this design does not do (deleted stops publish `unplanned_stop.updated`)

### happy path
- [CRITICAL] untouched run-mode stop (updatedBy null) opened at 10:00:00, `closeOnRunning(..., 10:00:20, 60_000)` → returns `null` and no document remains
- [CRITICAL] the same stop with `updatedBy` set → it is closed at 10:00:20, kept, and returned
- [CRITICAL] a manual stop shorter than the debounce → it is closed at the running signal and kept, whatever its length

### boundaries
- run-mode stop lasting exactly the debounce (10:00:00 to 10:01:00, 60 000 ms) → closed and kept (only a stop shorter than the debounce is deleted)

### edge cases
- [HIGH] debounceMs 0 (the built-in default) and an untouched run-mode stop of 20 s → closed and kept, nothing is deleted
- the deletion of an untouched short stop publishes `unplanned_stop.updated`, as a manual delete does (there is no dedicated "deleted" event)

---

## RunMode.pendingRecord
> target: performance/src/modules/run-mode/run-mode.processor.test.ts
> plan-task: 4
> spec: Decision rules 1; Data and configuration changes (Redis)

### constraints
- a stopped signal at T0 with D > 0 and no planned stop covering T0 → a candidate is stored under `runmode:candidate:{workCenterId}:{runModeTagId}` with `since` = T0 (ISO 8601 UTC with `Z`), the `debounceMs` it starts with, `attempts` 0 and no `nextAttemptAt`, and a TTL of 25 hours (90 000 s) instead of `debounce + 2 s`
- the candidate is written in one command only when none is stored (`SET key value EX 90000 NX`): the first write wins

---

## RunMode.replayPageLimit
> target: performance/src/modules/run-mode/run-mode.processor.test.ts
> plan-task: 4
> spec: Decision rules 6 (page limit)

### constraints
- telemetry answers every state-durations page with `hasMore` (as only a fault would) while a gap is replayed → after 100 pages the sample fails and is not decided, and the replayed samples keep the cursor they advanced

---

## RunMode.unknownTag
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> spec: Decision rules 3 (404) and 4 (unknown tag)

### constraints
- [HIGH] a candidate is due and telemetry answers 404 for the tag → the candidate is deleted, one `run_mode.decision.unknown_tag` is logged at warn level, and no stop is created
- [HIGH] an after-planned check is pending and telemetry answers 404 for the tag → the check is deleted, one `run_mode.decision.unknown_tag` is logged at warn level, and no stop is created

---

## RunModeMonitorsClient.list
> target: performance/src/lib/internal-api/run-mode-monitors.client.test.ts
> plan-task: 8
> spec: Errors and retries, Tag map (the monitors client throws when work-center cannot answer)

### constraints
- [HIGH] work-center answers with a server error → `listRunModeMonitors()` throws `CustomError` 503 `error.work_center_unreachable`
- [HIGH] work-center cannot be reached (network failure) → `listRunModeMonitors()` throws the same 503 error
- a successful answer with an empty `data` → returns `[]` (no monitors is not an error)
