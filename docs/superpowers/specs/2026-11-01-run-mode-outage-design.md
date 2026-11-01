# Run-Mode Stops Through Outages — Design Spec

**Date:** 2026-11-01
**Status:** Approved section by section on 2026-11-01

---

## Problem

The performance service turns a work center's run-mode signal into unplanned stops. The signal is a
binary tag: 1 means running, 0 means stopped. With `runModeDebounceMs` above 0, a stop counts only when
the machine stays stopped at least that long. When telemetry or work-center cannot answer for a while,
or when signals reach performance late, real stops are lost without a trace and the OEE availability
reads higher than it was:

1. **Debounce confirmation.** When the debounce runs out, performance asks telemetry for the latest
   run-mode value. If telemetry cannot answer, the candidate expires about 2 s later through its Redis
   TTL (`debounce + 2 s`) and the stop is lost.
2. **Matured but unconfirmed candidate.** A running signal deletes the candidate even when the stop
   already outlasted the debounce. After an outage the queued signals arrive within milliseconds, so
   every stop of the outage that outlasted the debounce is lost. In normal operation the window is the
   1 s tick.
3. **Planned stop close.** If the run mode cannot be read when a planned stop closes, the check "is the
   machine still stopped" is skipped. A stopped machine sends no new signal, so the stop after the
   planned stop is never opened.
4. **Tag map.** On `work_center.updated` the run-mode mapping is dropped first and then re-read. If
   work-center cannot answer, the work center's signals are ignored until the event retry succeeds, and
   after five failed deliveries (about 3 minutes) until a restart.
5. **Startup monitor list.** If work-center cannot answer at startup, work centers that never had a
   signal processed are not monitored until a restart.
6. **Boot reconciliation.** It fails when telemetry is down at boot and is not retried. It is the only
   mechanism that could recover the transitions dropped by points 4 and 5.

Points 1 and 2 apply only when the debounce is above 0. With the built-in default of 0 a stop opens on
the first stopped signal and keeps the right times even when signals arrive late.

## Goals

- No stop is lost because a service could not answer for a while.
- A stop recorded late carries the machine's own start and end times.
- A stop is never created from missing information. "Cannot answer" never means "stopped".

## Non-goals

- Showing the machine state while telemetry is down. Nothing can know it; the operator panel shows no
  new stop during the outage.
- Changing what the debounce means. Stops shorter than the debounce are still not recorded.

## Background: how a signal travels

```
machine ──MQTT (QoS 1, persistent session)──▶ telemetry ──events.telemetry──▶ performance
                                                stores changes only,           maps tag → work center,
                                                with the device timestamp      handleRunModeSample
```

- Telemetry stores a value only when it changes (`same_value` is rejected) and drops samples older than
  the last stored one. A machine that keeps running or keeps standing sends nothing new: **silence means
  "no change", not "stopped"**.
- Every stored sample carries the device's timestamp (`msg.time`), not the time it reached a service.
- `GET /internal/v1/historian/:tagId/latest` returns the last stored change.
- When telemetry restarts, the broker delivers the QoS 1 messages it queued for telemetry's session, and
  telemetry stores and publishes them with their own timestamps. This needs a stable MQTT client id; see
  [Telemetry MQTT client id](#telemetry-mqtt-client-id).

## Decision rules

T0 is the time of a stopped signal, T1 the time of a running signal, D the debounce. Every decision uses
the machine's signal times, never the time a signal reached performance. The tick's "has D run out"
check is the one place that uses the clock, because the absence of a signal proves nothing.

### 1. Stopped signal at T0

- A planned stop covers T0: nothing happens (as today).
- D = 0: the stop opens at T0 at once (as today).
- D > 0: a candidate `{ firstStoppedAt: T0, debounceMs: D }` is written.

### 2. Running signal at T1

- A candidate exists and T1 − T0 ≥ D: the stop `[T0, T1]` is recorded closed, unless a planned stop
  covers T0, and the candidate is deleted. *Today the candidate is deleted and the stop is lost.*
- A candidate exists and T1 − T0 < D: no stop; the candidate is deleted (as today).
- An open unplanned stop of any source exists: it closes at T1 (as today). *New:* if it is a run-mode
  stop that would close shorter than D, because the machine sent the running signal late, and no user
  has changed it (`updatedBy` is null), it is deleted instead of closed, through the same path as a
  manual delete. A stop a user has changed is closed and kept, so no operator input is lost.

### 3. Tick, every second, for candidates whose D has run out

Performance asks telemetry for the latest sample of the tag:

- It is the candidate's own stopped sample (time T0, value below 1): the machine has stood since T0. The
  stop opens at T0 and the candidate is deleted.
- It is newer: performance has not processed that signal yet. The candidate waits and rules 1 and 2
  decide when the signal arrives.
- Telemetry cannot answer: the candidate waits and the question is asked again (see
  [Errors and retries](#errors-and-retries)).
- Telemetry does not know the tag (404): the candidate is deleted with a warning log; no decision can be
  made for that tag any more.

### 4. A planned stop closes at E

- The run mode can be read: as today, a stopped machine gets a stop opened at E.
- It cannot be read: a "check after planned stop" record `{ since: E }` is left under its own key, apart
  from the debounce candidate. Once telemetry answers, the history since E (`state-durations`) decides:
  - stopped at E: the stop `[E, first running signal]` is recorded, or opened at E if the machine is
    still stopped;
  - running at E: nothing.

  As today, no debounce applies to this check. If telemetry does not know the tag, the check is dropped
  with a warning log, as in rule 3.

### 5. Two writers, one stop

The tick and rule 2 can try to write the same stop at once. A unique index on `(workCenterId, startAt)`
for run-mode stops refuses the second write, which then counts as already recorded.

### Example (D = 60 s)

| Time | Event | Outcome |
|---|---|---|
| 10:00 | Machine stops | Candidate T0 = 10:00 |
| 10:00:30 | Telemetry goes down | |
| 10:01 | Tick asks telemetry, no answer | Candidate waits |
| 10:05 | Machine runs; the signal waits at the broker | |
| 10:10 | Telemetry is back, the 10:05 signal is processed | Rule 2: 5 min ≥ 60 s, stop `[10:00, 10:05]` recorded |

If the tick runs first at 10:10, it sees the newer 10:05 record, waits, and the outcome is the same.

## Errors and retries

### Pending decisions

Covers the debounce candidate and the check after a planned stop.

- When a service cannot answer, the decision waits. The question is asked again after 1, 2, 4, 8 and 16 s,
  then every 30 s. The tick still runs every second and skips records whose next attempt has not come.
  The attempt count and the next attempt time live in the Redis record.
- Logs mark changes, not attempts: a warning on the first deferral (`run_mode.decision.deferred`) and an
  info line with the time waited once it is decided (`run_mode.decision.resolved`).
- A record still undecided after 24 hours is dropped with an error log
  (`run_mode.decision.abandoned`), because a stop may have been lost. A 25-hour Redis TTL only clears
  orphaned keys.

### Tag map

- On a `work_center.*` event, work-center is read first. On success the mapping is updated, and the work
  center is reconciled when its tag changed or it is new.
- When work-center cannot answer, the old mapping stays and its signals keep being processed. The event
  is acknowledged, so it does not end up dead-lettered, and a full refresh starts.
- The full refresh reads the monitored work centers from work-center and retries until it succeeds, on
  the schedule above. It then updates the mapping and reconciles new or changed work centers. Startup
  runs the same refresh.
- The run-mode monitors client throws when work-center cannot answer, like the other internal clients.
  Today it returns an empty list, so a refresh could not tell "no monitors" from "could not read them".

### Boot reconciliation

Each work center is retried on its own until it succeeds. It runs in the background so it does not hold
up startup. Telemetry being down at boot only delays it.

### A late stop is written closed in one write

A recorded stop `[T0, T1]` is inserted already closed. Opening and then closing it could close another
stop open at that moment, such as an operator's manual stop, at T1. The insert classifies micro stops with
the same rule as `closeIfOpen` and publishes the opened and then the closed event.

### Crashes and restarts

- Candidates and checks live in Redis, which runs with AOF. After a performance restart the tick picks
  them up where it left off.
- A sample is acknowledged only after it is processed, so a crash redelivers it. The cursor guard and
  the unique index keep a stop from being written twice.

### Accepted risks

- Redis writes its AOF every second. A Redis crash can lose a candidate written in the last second.
- An operator may open a manual stop during an outage that overlaps the run-mode stop recorded late.
  The OEE already clips overlapping stops and reports `overlapping_stop_records_clipped`.

## Telemetry MQTT client id

Telemetry connects with `clientId: aimes-telemetry-${process.pid}`, `clean: false` and QoS 1. The broker
keeps queued messages per client id. When a restart changes the process id:

- the queue stays with the old client id and the late signals never arrive, which defeats the persistent
  session the telemetry spec asks for;
- the broker keeps queuing for the old session, so every restart leaves another orphaned session behind.

In Docker the process id under `dumb-init` stays the same in practice, which hides this, but nothing
guarantees it. The client id comes from config instead (`MQTT_CLIENT_ID`), with the stable default
`aimes-telemetry`.

## Data changes

- **Redis**
  - `runmode:candidate:{workCenterId}:{runModeTagId}` gains `attempts` and `nextAttemptAt`; its TTL
    becomes 25 hours.
  - New `runmode:after-planned:{workCenterId}:{runModeTagId}`:
    `{ since, attempts, nextAttemptAt }`, same TTL.
- **MongoDB:** unique index on unplanned stops `{ workCenterId: 1, startAt: 1 }` with the partial filter
  `{ source: 'run_mode' }`. The product is not released, so there is no migration; a local database that
  already holds two run-mode stops with the same start must be cleaned before the index can build.
- **Config:** `MQTT_CLIENT_ID` for telemetry, default `aimes-telemetry`.

## Components

| Component | Change |
|---|---|
| `performance/src/modules/run-mode/run-mode.processor.ts` | Rules 1 and 2, deleting a stop shorter than D, `now` parameter |
| `performance/src/modules/run-mode/run-mode.debounce-tick.ts` | Rule 3, after-planned checks, retry schedule, 24-hour limit |
| `performance/src/modules/run-mode/run-mode.reconciler.ts` | Retry per work center in the background |
| `performance/src/modules/planned-stop/planned-stop.service.ts` | Rule 4: leave a check when the run mode cannot be read |
| `performance/src/modules/unplanned-stop/` | Insert a closed run-mode stop, unique index, duplicate counts as recorded |
| `performance/src/jobs/subscribers.ts` | Read work-center before changing the map, full refresh with retries |
| `performance/src/lib/internal-api/run-mode-monitors.client.ts` | Throw when work-center cannot answer |
| `telemetry/src/lib/mqtt.ts`, telemetry config | Client id from `MQTT_CLIENT_ID` |
| `packages/testing` | Redis test container helper using the image docker-compose.yml runs |
| `e2e/src/global-setup.ts` | Stop and start a service during a test |

## Testing

Tests run against real infrastructure: MongoDB and Redis in test containers, and telemetry and
work-center as real HTTP stub servers, as in the OEE contract test, that a test can take down and bring
back. The processor and the tick take a `now` parameter, so tests decide the clock and never sleep;
production passes the real time.

### Integration (performance)

1. Telemetry is down when D runs out and back while the machine still stands: the stop opens at T0, not
   when telemetry came back.
2. The running signal arrives late while telemetry is down: T1 − T0 ≥ D records `[T0, T1]`; T1 − T0 < D
   records nothing.
3. A burst after an outage, 0@10:00, 1@10:00:20, 0@10:00:40, 1@10:03 with D = 60 s, records only
   `[10:00:40, 10:03]`.
4. The tick sees a newer telemetry record: it opens nothing and the signal decides; no false stop, no
   duplicate.
5. The tick and a running signal write the same candidate at once: one stop.
6. The machine sends the running signal late: an untouched short stop is deleted; a stop an operator gave
   a reason is closed and kept.
7. A planned stop closes while telemetry is down; once it is back, stopped at E records
   `[E, first running signal]` and running at E records nothing.
8. Retries come after 1, 2, 4 … 30 s; only the deferred and resolved lines are logged; after 24 hours the
   record is dropped with an error log.
9. Work-center is down on `work_center.updated`: the old mapping stays and signals keep being processed;
   once it is back the mapping is updated and the work center reconciled.
10. Work-center is down at startup: the list is retried until it arrives, and work centers without a
    cursor are mapped and reconciled. Telemetry is down at boot: reconciliation retries until it
    succeeds.
11. A pending candidate in Redis is decided after the processor restarts.

### End to end (real services and MQTT broker)

12. The machine publishes 0 over MQTT, telemetry is stopped, the machine publishes 1 while it is down,
    and telemetry is started again. Performance's API shows the stop `[T0, T1]` with the machine's own
    times. Services run as separate processes in the e2e harness, so the process id changes on restart
    and this scenario also proves the stable client id.

Before implementation, these scenarios are extracted to `docs/test-scenarios/performance.md`.

## Rejected approaches

- **Periodic history reconciliation as the safety net.** Run the reconciler every minute and replay each
  work center's transitions from telemetry's history. One mechanism would recover points 1, 2, 4, 5 and
  6, but the candidate would have to move into MongoDB next to the cursor, two writers would update the
  same state, telemetry would be queried every minute, and point 3 would still need its own handling.
- **Pending decisions in MongoDB.** Keep the candidate and the after-planned check in the run-mode
  processing state document. Redis already persists them with AOF and the stream redelivers unfinished
  samples, so the gain is small; it would mostly move the same logic elsewhere.

## What this design does not do

- It does not show the machine state while telemetry is down.
- It does not change what the debounce or the micro stop threshold mean.
- It does not add a dedicated "deleted" event; a deleted stop publishes `unplanned_stop.updated`, as a
  manual delete does today.
