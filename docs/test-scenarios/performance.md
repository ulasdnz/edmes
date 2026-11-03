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
- [HIGH] the newer latest sample is a stopped one (the machine ran at 10:05 and stopped again at 10:10, neither sample processed yet) → the tick opens no stop at 10:00 and keeps the candidate; once 0@10:10 arrives, its replay of 1@10:05 records [10:00, 10:05] and a candidate since 10:10 is stored

### state transitions
- [CRITICAL] the tick waited on a newer record, then the running signal arrives with T1 - T0 >= D → exactly one stop [T0, T1] is recorded (no duplicate) and the candidate is deleted
- [CRITICAL] the tick waited on a newer record, then the running signal arrives with T1 - T0 < D → no stop is recorded (no false stop) and the candidate is deleted
- [CRITICAL] candidate T0 = 10:00, 1@10:05 never reaches performance and is telemetry's latest sample, the tick runs at 10:10, then 0@10:20 arrives with `previousOccurredAt` 10:05 → the tick keeps the candidate, the replay of 1@10:05 records [10:00, 10:05], and a candidate since 10:20 is stored

---

## RunMode.concurrentDecision
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> scenario: 5
> see-also: UnplannedStop.recordClosedFromRunMode, UnplannedStop.openFromRunMode (plan Task 3: the unique index behind it)

### edge cases
- [CRITICAL] the tick (the latest telemetry sample is the T0 stopped sample) and the running signal (T1 - T0 >= D) decide the same candidate at the same moment → exactly one run-mode stop with startAt = T0 exists, closed at T1, and neither writer fails (the second write counts as already recorded)
- [CRITICAL] the tick has asked telemetry about the candidate, the running signal records [T0, T1] and deletes the candidate, then telemetry fails the tick's question → the candidate is not written back (the retry fields are written only while the stored record has the same `since`) and no deferral is logged
- [CRITICAL] the tick has asked telemetry about candidate T0 = 10:00, the machine runs at 10:05 and stops again at 10:06 (a candidate since 10:06 is stored), then telemetry answers with the 10:00 stopped sample → [10:00, 10:05] stays the only stop and the candidate since 10:06 is kept (a decided record is deleted only while it has the same `since`)
- [CRITICAL] the tick has asked telemetry about candidate T0 = 10:00 (D = 60 s), the running signal at 10:00:20 is processed meanwhile (no stop, the candidate deleted), then telemetry answers with the 10:00 stopped sample it computed before storing 10:00:20 → no stop is opened, none is open and no candidate is left: the tick decides only while its record has the same `since` and the cursor has not moved since before its request

---

## RunMode.tagLock
> target: performance/src/modules/run-mode/run-mode.lock.test.ts
> plan-task: 5
> spec: Decision rules 5 (the tick and the rules take turns per tag)

### constraints
- [HIGH] three callers for one work center and run-mode tag → each runs only after the one before it has finished, in the order they came, even when a later one is ready first
- a caller for another tag → runs while the first tag is held
- [HIGH] a caller fails → the failure reaches that caller, and the next caller for the tag runs

---

## RunMode.lateRunningSignalOnShortStop
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 4
> scenario: 6
> see-also: UnplannedStop.closeOnRunning (plan Task 3: the same rule at service level)

### happy path
- [CRITICAL] untouched run-mode stop (updatedBy null) the tick opened at 10:00 under its candidate's D = 60 s, running signal at 10:00:20 (shorter than D) → the stop is deleted and no unplanned stop remains for the work center
- [CRITICAL] run-mode stop the tick opened at 10:00 under D = 60 s that a user has changed (updatedBy set, for example an operator gave it a reason), running signal at 10:00:20 → the stop is closed at 10:00:20 and kept, with the user's change intact

### edge cases
- [CRITICAL] candidate since 10:00, an operator opens a manual stop at 10:30, then the late running signal at 10:25 is processed → [10:00, 10:25] is recorded and the manual stop stays open (a running signal never closes a stop that started after it)
- [HIGH] untouched run-mode stop opened at 10:30 (as a planned stop's close opens one from a history without the 10:25 signal), late running signal at 10:25 → the stop is deleted, through the same path as a manual delete
- [HIGH] run-mode stop opened at 10:30 that a user has changed, late running signal at 10:25 → the stop stays open with the user's change

---

## RunMode.debounceOnlyForTheTicksStop
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> spec: Decision rules 2 and 4 (only the stop the tick opened from a candidate is debounced; a stop opened without a debounce, at the end of a planned stop or with D = 0, closes however short)

### constraints
- [CRITICAL] a planned stop from 10:00 closes at E = 10:30, the run mode can be read and the machine stands (D = 60 s) → a stop opens at E; running at E + 30 s → [E, E + 30 s] is closed and kept
- [CRITICAL] the check after a planned stop opens the stop at E = 10:30 from a history without a running signal yet (D = 60 s), running at E + 30 s → [E, E + 30 s] is closed and kept, as when the check already sees the signal
- [CRITICAL] the tick opened the stop at T0 = 10:00 from a candidate with D = 60 s, running at 10:00:30 → the stop is deleted
- [HIGH] the same, with the policy's debounce set to 10 s after the tick opened the stop → the stop is still deleted: the debounce it was opened under decides
- [HIGH] D = 0: the stop opened at once at 10:00, running at 10:00:01 → [10:00, 10:00:01] is closed and kept

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
- a tick whose time is E itself → telemetry is not asked and the check stays (the history since E holds nothing yet); the next tick decides it
- [HIGH] the history holds no sample at or before E (the tag's first stored sample comes after E) → no stop is created and the check is deleted (a stop is never created from missing information)

### edge cases
- [HIGH] a planned stop from 10:00 covers 0@10:02 and closes at E = 10:30, telemetry first answers while the machine's 1@10:25 still waits at the broker → the check opens a stop at 10:30; once 1@10:25 arrives that untouched stop is deleted and no stop remains
- [HIGH] the same with D = 0, and 0@10:40 follows the late 1@10:25 → rule 1 opens a stop at 10:40, the only stop
- [CRITICAL] a planned stop from 10:00 covers 0@10:02 and closes at E = 10:30, the tick at 10:33 asks for the history since E, 1@10:32 is processed meanwhile, then telemetry answers with the history it computed before storing 1@10:32 (stopped since E, no running signal) → that tick opens nothing and leaves the check as it was (no attempt counted); the tick at 10:34 records [10:30, 10:32] and deletes the check
- [HIGH] the same with the running signal at 10:28, before E → that tick opens nothing, and the tick at 10:34 records nothing and deletes the check

---

## PlannedStop.closeWithoutRunMode
> target: performance/src/modules/run-mode/__contract__/run-mode-after-planned-stop.contract.test.ts
> plan-task: 6
> spec: Decision rules 4 (the check is left); first half of the scenario carried by RunMode.checkAfterPlannedStop
> note: the plan named planned-stop.service.test.ts; the check is a Redis record written through the service's raw Redis client, which lets every Redis error reach the caller instead of turning it into "not stored", so these tests run in the contract suite on real Redis and MongoDB

### happy path
- [CRITICAL] a planned stop closes at E and telemetry cannot be reached to read the run mode → the check `{ kind: 'after_planned', since: E (ISO 8601 UTC with Z), pendingSince: the server's time of the write (ISO 8601 UTC with Z), debounceMs: 0, attempts: 0, nextAttemptAt: null }` is stored under `runmode:after-planned:{workCenterId}:{runModeTagId}` with a TTL of 25 hours, and no stop is opened at that moment; the only warn line is the failed request's `internal_api.telemetry.fetch_failed` with its status
- [HIGH] work-center cannot be reached when the planned stop closes → the run-mode tag is taken from the work center's `RunModeProcessingState` (its cursor) and the check is stored for that tag

### constraints
- the run mode can be read when the planned stop closes → no check is stored (a stopped machine gets its stop opened at E, as before)
- [HIGH] a debounce candidate of the same work center and tag is pending when the check is stored → the candidate stays untouched (the check has its own key)
- neither work-center nor a cursor yields a run-mode tag → `planned_stop.run_mode_unmonitored` is logged at warn level (after work-center's own `internal_api.work_center.fetch_failed`), nothing is stored, and closing the planned stop completes normally
- [HIGH] Redis refuses the check when the planned stop closes while telemetry cannot be reached → the close completes and returns the closed planned stop, no check is stored, and `planned_stop.run_mode_check_failed` is logged at error level with the planned stop, the work center, its `actualEndAt` and Redis's error (a stop may be lost)

### state transitions
- [CRITICAL] a planned stop from 10:00 covers 0@10:02 and closes at E = 10:30 while telemetry cannot answer; the tick at 10:31 still cannot read the history (the check stays, `attempts` 1); telemetry comes back having stored 1@10:34 → the tick at 10:40 records [10:30, 10:34] and deletes the check, and the later delivery of 1@10:34 changes nothing

---

## RunMode.closeReadsRunMode
> target: performance/src/modules/run-mode/__contract__/run-mode-after-planned-stop.contract.test.ts
> plan-task: 6
> spec: Decision rules 4 (the run mode can be read) and 5 (an answer that saw every processed sample)

### edge cases
- [CRITICAL] a planned stop from 10:00 covers 0@10:02 and closes at E = 10:30; while the close asks telemetry for the latest sample, 1@10:32 is processed, and telemetry answers with 0@10:02, computed before it stored 1@10:32 → the close opens no stop (it would stay open: the running signal is processed already) and leaves the check since 10:30; the tick at 10:33 records [10:30, 10:32] and deletes the check
- [HIGH] the same with the running signal at 10:28, before E → the close opens no stop and leaves the check since 10:30; the tick at 10:33 records nothing and deletes the check
- [CRITICAL] after 0@10:02 and 1@10:35 were processed, an operator closes a planned stop from 10:00 late, with the end it had, E = 10:30 → the close opens no stop and leaves the check since 10:30 (the latest sample, 1@10:35, came after E and says nothing about E); the tick at 10:40 records [10:30, 10:35]
- [HIGH] D = 0, the machine ran at E, and telemetry has stored its stop 0@10:35 that performance has not processed yet when the planned stop closes late with E = 10:30 → no stop opens at 10:30 and the check since 10:30 is stored; 0@10:35 then opens its own stop at 10:35 (the planned stop had closed by then), and the tick at 10:40 records nothing at E and deletes the check
- [HIGH] an operator converts a stop from 10:20 to 10:45 into a planned stop (closed at 10:45), and a planned stop from 10:00 closes at E = 10:30 while the run mode can be read and the machine stands → no stop opens at 10:30 and no check is stored: the converted planned stop covers E in rule 1's meaning

---

## RunMode.runsAfterLateEnd
> target: performance/src/modules/run-mode/__contract__/run-mode-after-planned-stop.contract.test.ts
> plan-task: 6
> spec: Decision rules 4 (the check decides the stopped runs the planned stop hid after its end)
> see-also: RunMode.closeReadsRunMode (a late close whose samples after E performance has not processed yet: they decide themselves when they arrive)

While a planned stop over 10:00 to 11:00 is active, every sample is processed and covered, also those after 10:30; an operator then closes it late, with the end it had, E = 10:30, and the close leaves the check since 10:30 (its latest sample came after E).

### edge cases
- [CRITICAL] D = 0, samples 0@10:02, 1@10:30, 0@10:35 → the tick at 10:40:01 records nothing at 10:30 (running at E) and opens the stop at 10:35, where the machine has stood since
- [CRITICAL] the same with D = 60 s → the tick leaves the candidate since 10:35 and opens no stop; the next tick confirms it and opens the stop at 10:35
- [HIGH] D = 60 s, samples 0@10:02, 1@10:30, 0@10:31, 1@10:31:30, 0@10:33, 1@10:38 → the tick records [10:33, 10:38] only: the 30 s stop from 10:31 is shorter than D
- [HIGH] D = 0, a planned stop over 10:41 to 10:55 that has not started, samples 0@10:02, 1@10:30, 0@10:33, 1@10:38, 0@10:42 → the tick records [10:33, 10:38] and nothing for the stop since 10:42, which the other planned stop covers
- [HIGH] D = 0, samples 0@10:02, 1@10:30, 0@10:35, and a changeover planned stop starts at 10:40 right after the late close while the machine still stands → the tick records [10:35, 10:40]: the changeover's start would have closed the stop
- [HIGH] the same, and the machine runs at 10:45 during the changeover → the tick records [10:35, 10:40], not [10:35, 10:45]
- [HIGH] D = 60 s, more samples after E than one page of history holds (500): stops and runs of a second each, a stop from 10:38:19 that the machine ended at 10:40:19 (the cursor) and closes the page, and 0@10:41:40 on the next page → the tick records [10:38:19, 10:40:19] (the page's last stop ended where the machine ran) and leaves no candidate; 0@10:41:40 comes after the cursor and leaves its own candidate when it is processed

---

## RunMode.signalInClosedPlannedStop
> target: performance/src/modules/run-mode/__contract__/run-mode-after-planned-stop.contract.test.ts
> plan-task: 6
> spec: Decision rules 1-3 (a planned stop covers T when its planned window holds T and it had not closed by T)

### edge cases
- [CRITICAL] D = 0, cursor at 1@09:00, a planned stop from 10:00 to 11:00 has closed at E = 10:30, then 0@10:05 is processed (from a backlog) → no stop opens inside the planned stop and the check since 10:30 is stored; the tick at 10:31 opens the stop at 10:30 and deletes the check
- [HIGH] candidate since 10:05 (D = 60 s), a planned stop from 10:00 to 11:00 is entered afterwards and has closed at 10:30, then 1@10:40 arrives → no stop [10:05, 10:40], the candidate is deleted and the check since 10:30 is stored; the tick at 10:41 records [10:30, 10:40]
- [HIGH] candidate since 10:00 (D = 60 s), a planned stop over 09:59 to 10:30 that ran from 09:59 to E = 10:00:30 is entered afterwards, then 1@10:00:50 arrives, shorter than D → no stop, the candidate is deleted and the check since 10:00:30 is stored; the tick at 10:01 records [10:00:30, 10:00:50] (planned time inside the planned stop, no debounce after its end)
- the same with 1@10:00:20, before E → the check since 10:00:30 is stored and the tick at 10:01 records nothing and deletes it
- [HIGH] overlapping planned windows: a planned stop over 10:00 to 10:40 ran until E = 10:30, another over 10:20 to 10:50 was never started; the late 0@10:25 → the check since 10:30 is stored (the planned one does not hide the closed one), and the tick at 10:31 records nothing at 10:30, which the planned one covers, and deletes the check
- [HIGH] the same candidate and planned stop, and the tick at 10:31 finds the 10:05 stopped sample still the tag's latest → no stop opens at 10:05, the candidate is deleted and the check since 10:30 is stored; the tick at 10:31:01 opens the stop at 10:30
- [CRITICAL] performance lags telemetry: a planned stop from 10:00 covers 0@10:02, telemetry has stored 1@10:10 and 0@10:20 when the planned stop closes at E = 10:30, so the close reads 0@10:20 and opens the stop at 10:30; 1@10:10 is then processed and deletes that stop (rule 2), and 0@10:20 is processed → no candidate, the check since 10:30 is stored, and the tick at 10:31 opens the stop at 10:30 again

---

## RunMode.oneCheckPerTag
> target: performance/src/modules/run-mode/__contract__/run-mode-after-planned-stop.contract.test.ts
> plan-task: 6
> spec: Decision rules 4 (the earliest pending E, the end at the next planned stop's start, the handover)

### state transitions
- [CRITICAL] telemetry cannot answer while planned stops [10:00, 10:30] and [10:40, 10:50] close; the machine stood from 10:05 to 10:35 and from 10:45 to 10:55 → after both closes the check since 10:30 is stored; once telemetry answers, the tick at 10:56 records [10:30, 10:35] and leaves the check since 10:50, and the tick at 10:56:01 records [10:50, 10:55] and deletes the check
- [CRITICAL] the same planned stops while the machine stood from 10:05 until 11:00 → the ticks record [10:30, 10:40] (the start of the second planned stop ends it) and [10:50, 11:00]
- [HIGH] the first planned stop closes at 10:30 while telemetry answers without the machine's 0@10:05 (the broker still holds it), so the close leaves nothing; the second closes at 10:50 while telemetry cannot answer and leaves the check since 10:50; then the backlog 0@10:05, 1@10:35, 0@10:45, 1@10:55 is processed → 0@10:05 replaces the pending check with the check since 10:30 (0@10:45 cannot replace it with the later 10:50), and the ticks record [10:30, 10:35] and [10:50, 10:55]
- [HIGH] the check since 10:30 has waited 23 hours (2 of its 25 hours of TTL left) when it is decided → the check since 10:50 it hands over has a TTL of 25 hours of its own (above 89 900 s)
- [HIGH] a planned stop planned until 10:20 ran until E = 10:30, into the window of a second planned stop planned from 10:25, started at 10:40 and closed at 10:50; the late 0@10:05 leaves the check since 10:30 and 1@10:55 follows → the tick at 10:56 records nothing at 10:30 (the second planned stop covers it, as the close would have found) and hands the key to the check since 10:50; the tick at 10:56:01 records [10:50, 10:55]
- [HIGH] telemetry cannot answer while planned stops close at 10:30 and at 12:00, so the check since 10:30, written at 10:30, is kept; the machine stood from 11:50 to 12:05 → the tick a day after 10:30 (24 h 1 s later) drops the check since 10:30 with one `run_mode.decision.abandoned` (error) and stores the check since 12:00 in its place; the next tick records [12:00, 12:05]
- [HIGH] the same two closes, and MongoDB cannot read planned stops when the check since 10:30 is due to be dropped → the drop waits: the record holds `attempts` 1 and a `nextAttemptAt` 1 s later, one `run_mode.decision.deferred` is logged with MongoDB's error, and a tick before that time tries nothing; once MongoDB reads again the next attempt drops it with `run_mode.decision.abandoned` (`attempts` 1) and stores the check since 12:00
- [CRITICAL] the second planned stop closes while telemetry is down, after the drop of the expired check since 10:30 has read that no planned stop closed after 10:30 and before it swaps the key → the close's check, refused while the earlier one is stored, waits for the drop under the tag's lock and is stored afterwards: the check since 12:00 is not lost

---

## RunMode.checkReplacedWhileAsked
> target: performance/src/modules/run-mode/__contract__/run-mode-after-planned-stop.contract.test.ts
> plan-task: 6
> spec: Decision rules 5 (the tick decides only while its record has the same `since`)

### edge cases
- [CRITICAL] the machine stands since 10:10; a planned stop from 10:35 to 10:40 closed while telemetry could not answer and left the check since 10:40; the tick at 10:41 asks for the history since 10:40, and meanwhile a planned stop from 10:00 to 10:30, entered after the fact, closes while telemetry cannot answer: its check since 10:30 replaces the pending one and no sample moves the cursor; then telemetry answers → the tick opens nothing and the check since 10:30 stays as written; the next ticks record [10:30, 10:35] and open the stop at 10:40

---

## PlannedStop.retroactiveStart
> target: performance/src/modules/planned-stop/planned-stop.service.test.ts
> plan-task: 6
> spec: Decision rules 2 (no close ends a stop before it starts)

### edge cases
- [HIGH] a run-mode stop opened at 12:05 is open and a planned stop is started with `actualStartAt` 12:00 → that stop stays open (`endAt` null), to close at its own running signal: no stop ends before it starts

---

## RunMode.retrySchedule
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> scenario: 8
> note: the owner approved changing the first two edge cases on 2026-11-04. They counted the 24 hours from `since`, the stop's own time, so the record of a stop older than a day was dropped at its first tick and the stop was lost: a machine that had stood for days when monitoring started, or a planned stop closed a day late with its earlier end. The 24 hours now count from `pendingSince`, the server's time when the record became pending: set by its first write, kept by its deferrals, and set afresh when a check is handed on

### state transitions
- [HIGH] telemetry keeps failing: the tick (which runs every second) asks again 1 s after the first failed attempt, then 2, 4, 8 and 16 s after the following failures, and every 30 s after that; the ticks in between skip the record without calling telemetry
- [HIGH] a decision that waits through several failed attempts and is then made → exactly one `run_mode.decision.deferred` (warn, at the first failure) and one `run_mode.decision.resolved` (info, with `waitedMs`) are logged for it; the failed attempts in between add no log line
- [HIGH] while a decision retries, every warn and error line is the decision's own: the tick's telemetry requests log no transport line at warn, and the deferred line names the cause in `cause` (the HTTP status, such as `HTTP 500`, the fetch error or the timeout)
- [HIGH] MongoDB refuses the stop the tick opens for a due candidate → the decision is deferred on the same schedule and telemetry is asked again only when the next attempt is due; one `run_mode.decision.deferred` with MongoDB's error is logged, and once MongoDB writes again the stop opens at T0 and one `run_mode.decision.resolved` follows
- an after-planned check whose history cannot be read follows the same retry schedule and logs the same two lines as a candidate
- a candidate the tick deferred is decided by the running signal → one `run_mode.decision.resolved` (info, with `waitedMs`) follows the deferral

### constraints
- after each failed attempt the Redis record holds `attempts` increased by one and `nextAttemptAt` (ISO 8601 UTC with `Z`) set to the attempt time plus the delay of that attempt, and keeps the TTL it was written with

### edge cases
- [HIGH] a record still undecided with its `pendingSince` more than 24 hours before the tick's `now` → the record is deleted, one `run_mode.decision.abandoned` is logged at error level, and no stop is created
- a record undecided with its `pendingSince` just under 24 hours before `now` (23 h 59 min) → it is still pending and retried, and nothing is abandoned
- [CRITICAL] monitoring starts for a machine whose latest sample, 0@T0, is two days old, with D = 60 s → the reconciler's candidate since T0 is pending from the moment it is written, and the tick after it opens the stop at T0; nothing is abandoned
- [CRITICAL] a planned stop that ended at E is closed 30 hours later with that end, and the tag's latest sample came after E, so the close leaves the check at E → the next tick decides it from the history since E: the machine stood at E and ran at T1, so `[E, T1]` is recorded; nothing is abandoned

---

## TagMap.updateWhileWorkCenterDown
> target: performance/src/jobs/__contract__/tag-map.contract.test.ts
> plan-task: 8
> scenario: 9
> see-also: RunModeMonitorsClient.list (plan Task 8: the client the refresh reads through), TagMap.monitoringStops

### happy path
- work-center answers on `work_center.updated` and the run-mode tag changed → the new tag maps to the work center (the old tag no longer does), the old tag's cursor is deleted, and the work center is reconciled from the new tag's latest sample
- work-center answers for a work center that is new to the map → it is mapped and reconciled
- work-center answers and the tag is unchanged → the mapping stays as it is and the work center is not reconciled again

### edge cases
- [CRITICAL] work-center cannot answer on `work_center.updated` → the old mapping stays (`workCenterForTag(oldTag)` still returns the work center, so its signals keep being processed), `syncWorkCenter` resolves without throwing (the event is acknowledged, not dead-lettered), and a full refresh is requested; the only warn lines are the work center read's own failure and one `run_mode.tag_map.refresh_failed` with the cause
- [HIGH] after that failed update work-center answers the refresh's monitor list → the mapping is replaced by the list (the new tag is mapped), the old tag's cursor and candidate are deleted, the work center is reconciled, and one `run_mode.tag_map.refresh_recovered` (info, with `attempts`) is logged
- [HIGH] several updates fail while work-center is down → only one refresh loop runs at a time, on the retry schedule; the updates that come while it runs leave work-center to it instead of reading it themselves
- [HIGH] an update comes while the refresh waits for the monitor list, and the list it gets predates the update → the update does not read work-center itself; the refresh reads the list once more after applying the first answer, and the work center's new tag is mapped
- [HIGH] the reconciliation of a new work center fails because telemetry cannot answer → it is retried on the retry schedule until telemetry answers; its only warn line is one `run_mode.reconciler.failed` with the cause, followed by one `run_mode.reconciler.recovered` (info)

---

## TagMap.startupWhileWorkCenterDown
> target: performance/src/jobs/__contract__/tag-map.contract.test.ts
> plan-task: 8
> scenario: 10
> see-also: RunMode.bootReconciliation (plan Task 7: the second half, telemetry down at boot)

### edge cases
- [HIGH] work-center cannot answer at startup → work centers that have a cursor are mapped from their cursors and their signals are processed, while the monitor list is retried on the retry schedule until it arrives
- [HIGH] the list arrives after some failed attempts → work centers without a cursor (never had a signal processed) are mapped and reconciled; work centers already known with an unchanged tag are not reconciled again
- the refresh logs one `run_mode.tag_map.refresh_failed` (warn, with the cause) at its first failure and one `run_mode.tag_map.refresh_recovered` (info, with `attempts`) once the list arrives; its requests log their failures at debug

---

## TagMap.monitoringStops
> target: performance/src/jobs/__contract__/tag-map.contract.test.ts
> plan-task: 8
> spec: Errors and retries, Tag map (a work center that stops being monitored loses its run-mode state)

### state transitions
- [CRITICAL] a work center with a cursor at 10:00 loses its run-mode tag, the machine stops at 10:05 and runs at 10:10 while it is unbound, and the tag is bound again → the cursor was deleted when it was unbound; monitoring starts from the latest sample (cursor at 10:10), the next signal 0@10:30 replays nothing, and no stop is recorded for `[10:05, 10:10]`
- [HIGH] a work center with a cursor and a candidate is archived, or deleted (work-center answers 404) → its tag is no longer mapped, and its cursor and candidate are deleted
- [HIGH] the refresh's monitor list no longer names a work center → its tag is no longer mapped and its cursor and candidate are deleted; a work center the list still names with the same tag keeps its mapping and state and is not reconciled again
- [HIGH] a work center's reconciliation is waiting on telemetry when its tag is unbound → the reconciliation is cancelled before the state is deleted, so telemetry's late answer writes no candidate and no cursor
- [HIGH] rule 6's replay is waiting on telemetry when the refresh stops monitoring the work center → once telemetry answers, neither the replayed stopped sample nor the signal that started the replay is decided: no cursor, no candidate and no stop for the old tag
- [HIGH] a work center whose run-mode stop opened at 10:00 is archived, deleted (work-center answers 404), or loses its run-mode tag at 10:20 by the server's clock → the stop is closed at 10:20 and kept, and `run_mode.tag_map.unmonitored` names it in `closedStopId`; a work center whose run-mode tag changes meanwhile keeps its stop open, for the new tag's first running signal to close
- each work center that stops being monitored logs one `run_mode.tag_map.unmonitored` (info)

---

## TagMap.shutdown
> target: performance/src/jobs/__contract__/tag-map.contract.test.ts
> plan-task: 8
> spec: Errors and retries, Tag map

### edge cases
- [HIGH] `stopRefresh` while the refresh waits for its next attempt → it resolves at once and no further attempt is made
- [HIGH] `stopRefresh` while a reconciliation waits on telemetry → it resolves without waiting for telemetry or the request timeout, and telemetry's late answer writes nothing

---

## RunMode.bootReconciliation
> target: performance/src/modules/run-mode/__contract__/run-mode-reconciler.contract.test.ts
> plan-task: 7
> spec: Errors and retries, Boot reconciliation; second half of the scenario carried by TagMap.startupWhileWorkCenterDown

### constraints
- [HIGH] telemetry cannot answer for a work center → `reconcileWorkCenter` throws (the failure is not swallowed)
- `reconcileWorkCenter` logs no warn or error line of its own: its telemetry requests (the replay's pages and `latest`) log their failures at debug, and the caller that retries it logs the failure

### edge cases
- [HIGH] telemetry is down at boot → `startBootReconciliation` retries that work center on the retry schedule until telemetry answers, and the work center is then reconciled
- [HIGH] telemetry is down at boot → `startBootReconciliation()` returns without waiting for telemetry, so startup is not held up
- each monitored work center is retried on its own: one whose reconciliation keeps failing does not delay another that succeeds on its first attempt
- [HIGH] a work center whose reconciliation fails before it succeeds → its only warn line is one `run_mode.reconciler.failed` at its first failure, with the cause, and one `run_mode.reconciler.recovered` (info, with `attempts`, the failed attempts) follows its success
- [HIGH] no cursor, telemetry's latest sample is running, and the event path processes a newer sample before telemetry answers → the cursor stays at the newer sample: under the tag's lock the reconciler writes a cursor only while the tag has none
- [HIGH] no cursor, the event path processes 0@10:05 while `latest` is asked, and `latest` answers 1@10:06 → the reconciler writes no cursor; the delivered 1@10:06 still decides the candidate: `[10:05, 10:06]` is recorded (D = 60 s), no candidate is left and the cursor ends at 10:06
- [HIGH] no cursor, the event path processes 0@10:00 while `latest` is asked, and `latest` answers 0@10:10, newer than that cursor → the reconciler decides nothing (the cursor stays at 10:00, the candidate since 10:00 stays); the delivered 1@10:05 records `[10:00, 10:05]` and the delivered 0@10:10 writes its candidate
- [HIGH] the replay reaches its page limit before `now` → the reconciliation goes on from the cursor the replayed samples advanced until it reaches `now`, and every stop of the history is recorded
- a replay that reaches its page limit without moving the cursor (only a telemetry fault does that) → `reconcileWorkCenter` throws instead of asking for the same pages again
- [HIGH] `stopBootReconciliation` → a retry still waiting never starts, and the stop does not wait for its time; a request in flight is aborted and its late answer writes nothing; a replay stops before its next sample, and the stop resolves once the sample being written is written
- [HIGH] a work center listed from its cursor stops being monitored before it is reconciled → it is skipped: telemetry is not asked, and no cursor and no candidate are written (it never starts from its latest sample)
- [HIGH] a work center stops being monitored while its replay waits on telemetry → once telemetry answers, the replayed stopped sample decides nothing: no cursor and no candidate

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
- [HIGH] telemetry never answers a request → the request is cut off after 5 s and counts as "cannot answer": the record is deferred (`attempts` increased by one, `nextAttemptAt` set, one `run_mode.decision.deferred` logged with the timeout as its `cause`) and no stop is created
- [HIGH] candidates of two work centers are due and telemetry never answers for the first one's tag → the other work center's stop is opened no later than 5 s after the tick starts
- [HIGH] telemetry never answers the state-durations request of a gap replay (rule 6) → the sample fails within 5 s and nothing is decided for it (no stop, the candidate as it was, the cursor where it was)

---

## RunMode.tickSurvivesRedisErrors
> target: performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts
> plan-task: 5
> spec: Errors and retries (pending decisions); Crashes and restarts

### edge cases
- [HIGH] Redis refuses to list the pending decisions (SCAN) for several ticks → one `run_mode.debounce_tick.scan_failed` (warn) is logged when the listing starts failing, the process keeps running and the tick keeps ticking; once Redis answers, one `run_mode.debounce_tick.scan_recovered` (info) is logged and a due candidate is decided

---

## TagMap.tagChangesWhilePending
> target: performance/src/jobs/__contract__/tag-map.contract.test.ts
> plan-task: 8
> review-focus: 3

### edge cases
- [CRITICAL] a work center has pending decisions (a debounce candidate and an after-planned check) for its old run-mode tag and its run-mode tag changes → both pending decisions of the old tag and its cursor are deleted, so the old tag never decides for the machine
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
- [HIGH] telemetry cannot answer during the replay → the sample fails and nothing is decided for it (no stop, the candidate as it was, the cursor where it was), and the failed request logs `internal_api.telemetry.fetch_failed` at warn with its status; once telemetry answers, the redelivered sample replays the gap and records [10:00, 10:05] and [10:10, 10:15]
- [HIGH] Redis refuses the write of the second replayed sample's candidate → the sample fails, the first replayed sample keeps its stop and the cursor it advanced (10:05); the redelivered sample replays the rest

### edge cases
- [CRITICAL] cursor at 0@10:00, 1@10:05 never reaches performance, 0@10:10 arrives with `previousOccurredAt` 10:05 and its replay waits on telemetry, while the boot reconciler replays the tag up to 1@10:20 → [10:00, 10:05] and [10:10, 10:20] are each recorded once; once the waiting replay is answered, 0@10:10 is not decided again (no candidate is left) and the cursor stays at 10:20; the later delivery of 1@10:20 changes nothing

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
- [CRITICAL] untouched run-mode stop (updatedBy null) opened at 10:00:00 under a debounce of 60 000 ms, `closeOnRunning(..., 10:00:20)` → returns `null` and no document remains
- [CRITICAL] the same stop with `updatedBy` set → it is closed at 10:00:20, kept, and returned
- [CRITICAL] a manual stop shorter than the debounce → it is closed at the running signal and kept, whatever its length

### boundaries
- run-mode stop lasting exactly the debounce (10:00:00 to 10:01:00, 60 000 ms) → closed and kept (only a stop shorter than the debounce is deleted)

### edge cases
- [HIGH] an untouched run-mode stop of 20 s opened without a debounce (with D = 0, the built-in default, or at the end of a planned stop) → closed and kept, nothing is deleted
- the deletion of an untouched short stop publishes `unplanned_stop.updated`, as a manual delete does (there is no dedicated "deleted" event)

---

## RunMode.pendingRecord
> target: performance/src/modules/run-mode/run-mode.processor.test.ts
> plan-task: 4
> spec: Decision rules 1; Data and configuration changes (Redis)

### constraints
- a stopped signal at T0 with D > 0 and no planned stop covering T0 → a candidate is stored under `runmode:candidate:{workCenterId}:{runModeTagId}` with `since` = T0 (ISO 8601 UTC with `Z`), `pendingSince` = the server's time of the write (ISO 8601 UTC with `Z`), the `debounceMs` it starts with, `attempts` 0 and no `nextAttemptAt`, and a TTL of 25 hours (90 000 s) instead of `debounce + 2 s`
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
- a caller that logs the failure itself passes `failureLogLevel: 'debug'` → the client's own line is logged at debug, not warn, and the error carries the cause (`HTTP <status>` or the fetch error)
- the caller's signal aborts while work-center has not answered → the request stops and throws the same 503 error

---

## RunMode.tagNotBinary
> target: performance/src/modules/run-mode/__contract__/run-mode-not-binary.contract.test.ts
> plan-task: 8
> spec: Errors and retries, A run-mode tag that is not binary

### edge cases
- [HIGH] a `tag.value.recorded` sample of a mapped run-mode tag whose `behavior` is not `binary` → the run-mode rules skip it (no candidate, the cursor does not move), and one `run_mode.sample.not_binary` (warn, with `workCenterId`, `runModeTagId` and `behavior`) is logged for the tag, not one per sample
- a tag that sends a binary sample between two samples that are not binary → the binary sample is decided and the warning is logged again for the second
- a sample that carries no `behavior` → it is decided as before
- [HIGH] an after-planned check is due and telemetry answers 400 `historian.binary_only` → the check is deleted, one `run_mode.decision.not_binary` (warn) is logged, no stop is created, and telemetry is not asked again
- a check is due and telemetry answers any other 400 → the check is deferred as when telemetry cannot answer (`run_mode.decision.deferred` with cause `HTTP 400`)
- [HIGH] rule 6's replay gets 400 `historian.binary_only` → nothing is replayed, as for a tag telemetry does not know, and the signal is decided, so it is neither redelivered nor dead-lettered
- [HIGH] a reconciliation's replay gets 400 `historian.binary_only` → `reconcileWorkCenter` resolves instead of throwing, so it is not retried
