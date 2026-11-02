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
- A telemetry outage of up to 30 minutes at the design load loses no MQTT message, and the measured
  capacity is written down.

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
- Telemetry publishes every stored sample as `tag.value.recorded` with `previousOccurredAt`, the time of
  the tag's sample stored before it (null for its first). A consumer whose last processed sample is
  older than that knows it missed samples.
- `GET /internal/v1/historian/:tagId/latest` returns the last stored change.
- When telemetry restarts, the broker delivers the QoS 1 messages it queued for telemetry's session, and
  telemetry stores and publishes them with their own timestamps. That holds only within the broker's
  limits for the session, which today are far below what this design needs; see
  [Broker buffering](#broker-buffering).

## Decision rules

T0 is the time of a stopped signal, T1 the time of a running signal, D the debounce. Every decision uses
the machine's signal times, never the time a signal reached performance. The tick's "has D run out"
check is the one place that uses the clock, because the absence of a signal proves nothing.

### 1. Stopped signal at T0

- A planned stop covers T0: no stop and no candidate (as today). A planned stop covers T when its
  planned window holds T and it had not closed by T: it is planned or active, or it closed after T.
  That is the answer the signal got when it happened, however late performance processes it, such as
  from an outage backlog, a replay (rule 6) or a redelivery. When a planned stop that covered it has
  closed since, the signal leaves the check after it at its end E (rule 4), which decides from the
  history whether the machine still stood at E. That holds even while a planned or active planned
  stop covers the signal too, as overlapping planned windows allow: the check's own coverage test at
  E sorts out the overlap. Otherwise a late signal would open a stop inside the planned stop, and
  after a close that read a stale run mode nothing would open the stop at E.
- D = 0: the stop opens at T0 at once (as today).
- D > 0: a candidate `{ firstStoppedAt: T0, debounceMs: D }` is written, unless one is pending: the
  first write wins, in one Redis command (`SET … NX`), so a stop whose value stays below 1 across two
  stored samples keeps its first start.

### 2. Running signal at T1

- A candidate exists and T1 − T0 ≥ D: the stop `[T0, T1]` is recorded closed, unless a planned stop
  covers T0, and the candidate is deleted. *Today the candidate is deleted and the stop is lost.*
- A candidate exists and T1 − T0 < D: no stop; the candidate is deleted (as today).
- In both cases, a planned stop that covered T0 and has closed since leaves the check at its end, as
  in rule 1, however short the stop: the time inside the planned stop is planned, and no debounce
  applies after its end (rule 4).
- An open unplanned stop of any source exists: it closes at T1 (as today). *New:* if it is the
  run-mode stop the tick opened from a candidate (rule 3), it would close shorter than the debounce
  that candidate carried, because the machine sent the running signal late, and no user has changed
  it (`updatedBy` is null), it is deleted instead of closed, through the same path as a manual
  delete. The stop keeps that debounce, so a policy change after it opened does not apply to it. A
  run-mode stop opened without a debounce (rule 1 with D = 0, or at the end of a planned stop,
  rule 4) closes however short. A stop a user has changed is closed and kept, so no operator input
  is lost.
- An open stop that started after T1 is never closed: no stop ends before it starts. An operator's
  stop, or a run-mode stop a user has changed, stays as it is. An untouched run-mode stop that
  started after T1 is deleted, through the same path as a manual delete: every stop the processor
  opens starts at a sample it processed, so such a stop was opened at the end of a planned stop
  (rule 4) from a history that did not hold T1 yet, such as a broker backlog still draining when
  telemetry first answers, and T1 shows the machine was running before it.
- No close ends a stop before it starts, whoever closes it: a planned stop started retroactively at
  S closes only the stop that started at or before S, and leaves a later one open, to close at its
  own running signal.

### 3. Tick, every second, for candidates whose D has run out

Performance asks telemetry for the latest sample of the tag:

- It is the candidate's own stopped sample (time T0, value below 1): the machine has stood since T0. The
  stop opens at T0 and the candidate is deleted. When a planned stop covers T0, such as one entered
  after the signal was processed, no stop opens; one that has closed since leaves the check at its
  end, as in rule 1.
- It is newer: performance has not processed that signal yet. The candidate waits and rules 1 and 2
  decide when the signal arrives.
- Telemetry cannot answer: the candidate waits and the question is asked again (see
  [Errors and retries](#errors-and-retries)).
- Telemetry does not know the tag (404): the candidate is deleted with a warning log; no decision can be
  made for that tag any more.

### 4. A planned stop closes at E

As today, the close leaves nothing when another planned stop covers E. It asks that with rule 1's
meaning of covers, as the check below does, so a planned stop that closed after E, such as one
converted from an unplanned stop, covers E too.

The run-mode tag comes from work-center; a work center it names no run-mode tag for is not
monitored, and the close leaves nothing, as today. When work-center cannot answer, the work center's
cursor names the tag; with no cursor either, the close logs `planned_stop.run_mode_unmonitored` (warn)
and leaves nothing.

- The run mode can be read: as today, a stopped machine gets a stop opened at E. The latest sample
  decides only when it is the state at E, a sample from E or before. A later one says nothing about
  E, as when an operator closes the planned stop late with the end it had: deciding from it would
  lose `[E, T1]` when the machine ran only after E, or open a stop at E when the machine ran then.
  The answer also decides only if it saw every processed sample, as the tick's does (rule 5): the
  close reads the tag's cursor before it asks, and opens the stop under the tag's lock only while the
  cursor has not moved. A running signal processed while it asked would otherwise leave a stop at E
  that no running signal closes. Otherwise the close leaves the check below instead.
- It cannot be read, or work-center could not name the tag: a "check after planned stop" record
  `{ since: E }` is left under its own key, apart from the debounce candidate. Once telemetry answers,
  the history since E (`state-durations`) decides:
  - stopped at E: the stop `[E, first running signal]` is recorded, or opened at E if the machine is
    still stopped. The next planned stop that started after E ends the stop at its start, as that
    start would have closed it had it been open;
  - stopped at E while another planned stop covers E, in rule 1's meaning: nothing, as the close
    leaves no stop when another planned stop covers E. That holds for every check, whoever left it:
    the close, a late signal of rule 1, or the handover below. The planned stop that ended at E no
    longer covers it;
  - running at E: nothing.

  As today, no debounce applies to this check. If telemetry does not know the tag, the check is dropped
  with a warning log, as in rule 3.

  The check then decides the stopped runs the planned stop that ended at E hid. While it was still
  active, its planned window covered the stopped samples processed after E, so rule 1 left nothing
  for them, as when an operator closes a planned stop late with the end it had. Each stopped run
  that starts after E, at or before the tag's cursor and inside that planned window, gets what rules 1
  and 2 give it now that the planned stop ended at E:
  - a run the machine ended at e records `[s, e]` when e − s ≥ D;
  - the run the machine still stands in leaves the candidate since s (`SET … NX`), as rule 1 does,
    or opens the stop at s when D = 0.

  Another planned stop that covers s leaves the run alone, and the next planned stop's start ends it,
  as for the stop at E. Runs after the cursor stay with the normal path. Every write is idempotent, so
  a run decided already is not decided twice.
- One key holds one check, so a check write keeps the earliest pending E, in one Redis step: it writes
  when no check is stored or when the stored one waits on a later E. Planned stops such as changeovers
  can close twice within one outage, and a late signal of rule 1 can leave an earlier E than the
  pending one; overwriting or refusing either check would lose a stop. Deciding the check at E hands
  the key on, in the same compare-and-set that removes the record: the next planned stop that closed
  after E gets a fresh check at its end, with 25 hours of its own. A check dropped after 24 hours
  hands the key on the same way, so the checks refused while it waited are not lost with it. A check
  handed to a close that could read the run mode records the same stop again, which the unique start
  index refuses.
- The planned stop is closed already when its run mode is checked, so a failure that leaves no check
  behind, such as Redis refusing the write, does not fail the close. It is logged at error level
  (`planned_stop.run_mode_check_failed`), because a stop may be lost.
- In both cases the stop opened at E has no debounce: a running signal closes it however short, so the
  check that opens the stop and the check that already sees the running signal record the same stop.

### 5. Two writers, one stop

The tick and the rules take turns per tag. Every state change of one work center and run-mode tag
happens under one lock per `(workCenterId, runModeTagId)`, in the performance process. The lock covers:

- rule 1's candidate write, or its check after a planned stop;
- rule 2's decision;
- the cursor update, with its guard checked again, so the cursor only moves forward;
- the tick's decide-and-write;
- the planned stop's close: its stop at E, or its check (rule 4).

Telemetry is never asked under the lock. The tick asks first. A replay (rule 6) also asks first, and
each sample it replays then takes the lock for its own decision. The close asks first as well. The
lock is not re-entrant: a writer that holds it writes its check without taking it again.

The tick decides only from an answer that saw every processed sample. It reads the tag's cursor before
it asks telemetry. After the answer it takes the lock, and decides only when its record still has the
same `since` and the cursor has not moved. Otherwise it leaves the record for the next tick, with no
attempt counted and no log line. Without this check, an answer computed before telemetry stored a
running signal that performance processed meanwhile could open a stop at T0, or at E for the check
after a planned stop, that no running signal would close. A check replaced by an earlier one while
the tick asked (rule 4) moves no cursor; the same `since` is what keeps the tick from deciding it.

A unique index on `(workCenterId, startAt)` for run-mode stops refuses a second write of the same stop,
such as a decision made again after a failure part way. That second write counts as already recorded.

### 6. A signal whose predecessor was never processed

Each signal names the tag's previous stored sample (`previousOccurredAt`). When that is later than the
processing cursor's `lastProcessedOccurredAt`, telemetry stored signals performance never processed: a
sample that failed and was overtaken by a newer one before its redelivery, a dead-lettered sample, a
failed publish, or samples dropped while the tag map had a gap. Before deciding the signal,
performance replays telemetry's stored samples strictly between the cursor and the signal
(`state-durations`, with the boot reconciler's paging loop) through rules 1 and 2, each advancing the
cursor as a delivered signal does, and logs `run_mode.sample.gap_replayed` (warn) with `from`, `to`
and the number `replayed`. Then it decides the signal.

- `previousOccurredAt` null or equal to the cursor, or no cursor yet: telemetry is not asked.
- Telemetry cannot answer during the replay: the signal fails and the stream redelivers it, as with any
  other dependency failure. The samples replayed before the failure keep the cursor they advanced.
- The replay reaches its page limit before the signal: the signal fails the same way, and its
  redelivery goes on from the replayed samples.

Unlike the rejected periodic reconciliation, it runs only when a gap is proven, in the same writer
that processes the signals, with one telemetry request per gap.

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

- When telemetry cannot answer, or MongoDB or Redis fails while the decision is made or written, the
  decision waits. The question is asked again after 1, 2, 4, 8 and 16 s, then every 30 s. The tick
  still runs every second and skips records whose next attempt has not come. The attempt count and the
  next attempt time live in the Redis record.
- Logs mark changes, not attempts: a warning on the first deferral (`run_mode.decision.deferred`, with
  the cause) and an info line with the time waited once it is decided (`run_mode.decision.resolved`).
  The tick's telemetry requests log no line of their own at warn.
- When Redis cannot list the pending decisions, the tick logs `run_mode.debounce_tick.scan_failed`
  (warn) once, when the listing starts failing, and `run_mode.debounce_tick.scan_recovered` (info)
  once, when it works again. The tick keeps ticking meanwhile.
- A record still undecided after 24 hours is dropped with an error log
  (`run_mode.decision.abandoned`), because a stop may have been lost. A dropped check hands its key
  on to the next planned stop that closed after its E (rule 4). A 25-hour Redis TTL only clears
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
- A failed sample is redelivered only after the stream's reclaim delay, so a newer sample of the same
  tag can be processed first. Rule 6 replays the failed one from telemetry's history before that newer
  sample, and the cursor guard then skips the late redelivery. A sample dead-lettered after its last
  delivery is replayed the same way by the next sample of its tag.

### Accepted risks

- Redis writes its AOF every second. A Redis crash can lose a candidate written in the last second.
- An operator may open a manual stop during an outage that overlaps the run-mode stop recorded late.
  The OEE already clips overlapping stops and reports `overlapping_stop_records_clipped`.
- A broker crash loses the messages it received since its last autosave.
- One performance process writes the run-mode state, the writer rule 6 already assumes. The lock that
  makes the tick and the rules take turns (rule 5) lives in that process. A second performance
  instance would need a lock shared between processes, or one writer chosen among them.
- A telemetry outage longer than the target, or a load above the design load, fills the queue ceiling
  and the broker drops messages. This is detected and alerted (see
  [When an outage runs longer](#when-an-outage-runs-longer)), not prevented.

## Broker buffering

While telemetry is down, the broker is the only place a machine signal can wait. Today it holds far
too little:

- Telemetry connects with `clientId: aimes-telemetry-${process.pid}`. The broker keeps queued messages
  per client id, so when a restart changes the process id the queue stays with the old id and is lost,
  which defeats the persistent session the telemetry spec asks for. In Docker the process id under
  `dumb-init` stays the same in practice, but nothing guarantees it.
- The session expires 300 s after telemetry disconnects (`sessionExpiryInterval: 300`), and its queued
  messages with it. An orphaned session left by an old process id is gone after 5 minutes too, so the
  cost of a changing id is the lost queue, not a growing pile of sessions.
- `infra/mosquitto/mosquitto.conf` sets no queue limit, so Mosquitto's default applies: at most 1000
  queued messages per client. The plant publishes hundreds of messages per second (telemetry spec), so
  the queue fills within seconds and later messages are dropped.
- The broker container is limited to 128 MB of memory and 0.25 CPU.

### Target

A telemetry outage of up to **30 minutes** loses no MQTT message at the design load.

### Load model

There is no field data yet, so the design load is an explicit assumption, documented with the results;
a customer's own rate replaces it by repeating the measurement:

| Parameter | Design value |
|---|---|
| Message rate | 500 messages/s, for example 50 machines × 10 tags × 1 Hz |
| Message size | about 150 bytes including the topic |
| Run-mode transitions | a few per machine per hour |
| Outage | 30 minutes, about 900,000 queued messages |

### Settings

- **Telemetry:** `MQTT_CLIENT_ID`, default `aimes-telemetry`, and `MQTT_SESSION_EXPIRY_SECONDS`, default
  `1800`.
- **Broker** (`infra/mosquitto/mosquitto.conf`): `max_queued_messages 0`, so the message count is no
  longer the limit, and `max_queued_bytes` as the hard ceiling for the queue. Its value is the measured
  queue size of a 30-minute outage at the design load, plus 25%.
- **Broker container:** memory and CPU limits sized from the same measurement: the queue ceiling, plus
  the broker's own usage, plus a margin, so that a full queue never gets the broker killed.
- **`autosave_interval`**, which bounds what a broker crash loses, is chosen from the measured cost of
  writing a full queue to disk.

### Proof

- **In CI (e2e):** a modelled plant publishes while telemetry is stopped and started again. Every
  run-mode transition published during the outage ends up in telemetry's history with the machine's own
  time. The e2e broker runs the repository's `mosquitto.conf` with only authentication changed, so the
  test exercises the production settings. The harness runs services as separate processes, so the
  process id changes on restart and the stable client id is proven as well.
- **By hand (`pnpm test:capacity`):** the same plant at the design load with a 30-minute outage. It
  records the broker's peak memory, its message store size, the persistence file size, and how long
  telemetry takes to work off the backlog once it is back; telemetry has to ingest faster than the
  500 messages/s still arriving. The results go into `docs/operations/mqtt-broker-capacity.md` as a
  table, with the method, the assumptions and the commands to repeat it for another rate.

### When an outage runs longer

Once the ceiling is reached the broker drops new messages, and that must not go unseen. When telemetry
connects it reads the broker's dropped-message counter (`$SYS/broker/publish/messages/dropped`),
compares it with the value it saw last, and logs `mqtt.broker.messages_dropped` at error level with the
difference. A file-provisioned Grafana alert rule fires on that event. The broker restarting resets the
counter; telemetry then takes the new value as its baseline. Stops across such an outage still follow
the decision rules, with whatever signals survived.

## Data and configuration changes

- **Redis**
  - `runmode:candidate:{workCenterId}:{runModeTagId}` gains `attempts` and `nextAttemptAt`; its TTL
    becomes 25 hours.
  - New `runmode:after-planned:{workCenterId}:{runModeTagId}`:
    `{ since, attempts, nextAttemptAt }`, same TTL. It holds the earliest pending E; a decided check
    hands the key to the next planned stop that closed after E (rule 4).
- **MongoDB:** unique index on unplanned stops `{ workCenterId: 1, startAt: 1 }` with the partial filter
  `{ source: 'run_mode' }`. The product is not released, so there is no migration; a local database that
  already holds two run-mode stops with the same start must be cleaned before the index can build.
- **Telemetry config:** `MQTT_CLIENT_ID`, default `aimes-telemetry`; `MQTT_SESSION_EXPIRY_SECONDS`,
  default `1800`.
- **Telemetry event:** `tag.value.recorded` gains `previousOccurredAt`, the ISO 8601 UTC time of the
  tag's previous stored sample, or null for its first.
- **Broker:** `max_queued_messages 0`, `max_queued_bytes` and `autosave_interval` in
  `infra/mosquitto/mosquitto.conf`, and the broker's memory and CPU limits in `docker-compose.yml`, all
  set from the capacity measurement.

## Components

| Component | Change |
|---|---|
| `performance/src/modules/run-mode/run-mode.processor.ts` | Rules 1, 2 and 6, deleting a stop shorter than D, the replay loop rule 6 and the reconciler share, `now` parameter; a planned stop that has closed since covers a late signal; rule 4 at the close, the check's end at the next planned stop's start and its handover |
| `performance/src/modules/run-mode/run-mode.debounce-tick.ts` | Rule 3, after-planned checks, retry schedule, 24-hour limit |
| `performance/src/modules/run-mode/run-mode.reconciler.ts` | Retry per work center in the background; replays through the shared loop |
| `performance/src/lib/internal-api/run-mode-telemetry.client.ts` | State-durations segments in the shape telemetry answers (`state`, `start`, `end`) |
| `performance/src/modules/planned-stop/planned-stop.service.ts` | Rule 4: the run-mode tag from work-center or the cursor; leave a check when the run mode cannot be read; a failed check does not fail the close |
| `performance/src/modules/unplanned-stop/` | Insert a closed run-mode stop, unique index, duplicate counts as recorded; no close ends a stop before it starts |
| `performance/src/jobs/subscribers.ts` | Read work-center before changing the map, full refresh with retries; pass `previousOccurredAt` on |
| `performance/src/lib/internal-api/run-mode-monitors.client.ts` | Throw when work-center cannot answer |
| `telemetry/src/lib/mqtt.ts`, telemetry config | Client id and session expiry from config; dropped-message check on connect |
| `telemetry/src/jobs/events.ts`, `telemetry/src/modules/ingestion/ingestion.pipeline.ts` | `tag.value.recorded` carries the previous stored sample's time |
| `infra/mosquitto/mosquitto.conf`, `docker-compose.yml` | Queue ceiling, autosave interval, broker memory and CPU limits |
| `infra/grafana/provisioning/alerting/` | Alert rule on `mqtt.broker.messages_dropped` |
| `packages/testing` | Redis test container helper using the image docker-compose.yml runs |
| `e2e/src/global-setup.ts` | Stop and start a service during a test; run the repository's broker config |
| `e2e`, `pnpm test:capacity` | The 30-minute capacity measurement, run by hand |
| `docs/operations/mqtt-broker-capacity.md` | Measured table, method and assumptions |

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
6. The machine sends the running signal late: an untouched short stop the tick opened is deleted, also
   when the policy's debounce changed after it opened; a short stop opened without a debounce (D = 0) is
   closed and kept; a stop an operator gave a reason is closed and kept; a manual stop or a run-mode
   stop a user has changed that started after the signal stays open, and an untouched run-mode stop
   that started after it is deleted.
7. A planned stop closes while telemetry is down; once it is back, stopped at E records
   `[E, first running signal]` and running at E records nothing. A stop opened at E, by the close that
   reads the run mode or by the check, closes at a later running signal however short. When telemetry
   answers before it has stored a running signal from before E that the broker still holds, the stop
   opened at E is deleted once that signal arrives, and a stopped signal after it opens a stop again:
   through rule 1 after E, through the check at E before E. Two planned stops that close while
   telemetry is down each get their end decided; a machine that stood through the second gets
   `[E1, start of the second]` and `[E2, first running signal]`. A running signal processed while the
   close asks telemetry leaves the check instead of a stop at E. A stopped signal processed after the
   planned stop that covered it closed leaves the check at its end, whichever rule meets it.
8. Retries come after 1, 2, 4 … 30 s; only the deferred and resolved lines are logged; after 24 hours the
   record is dropped with an error log.
9. Work-center is down on `work_center.updated`: the old mapping stays and signals keep being processed;
   once it is back the mapping is updated and the work center reconciled.
10. Work-center is down at startup: the list is retried until it arrives, and work centers without a
    cursor are mapped and reconciled. Telemetry is down at boot: reconciliation retries until it
    succeeds.
11. A pending candidate in Redis is decided after the processor restarts.

Missed signals (rule 6), in the same suite, with a telemetry stub that answers `state-durations` from
its stored samples as telemetry does:

- A running signal fails and a newer stopped signal of the tag is processed first: the newer one
  replays it, both stops keep their own times, and the late redelivery changes nothing. The same when
  the candidate could not be deleted after the stop was written: no second stop at T0.
- Two signals never reach performance: the next one replays both, in their order.
- A signal that follows the one processed last, or a tag without a cursor, asks telemetry nothing.
- Telemetry cannot answer, or Redis fails part way, during a replay: the signal fails, the replayed
  samples keep their cursor, and the redelivery replays the rest once the dependency answers.

### End to end (real services and MQTT broker)

12. The machine publishes 0 over MQTT, telemetry is stopped, the machine publishes 1 while it is down,
    and telemetry is started again. Performance's API shows the stop `[T0, T1]` with the machine's own
    times. Services run as separate processes in the e2e harness, so the process id changes on restart
    and this scenario also proves the stable client id.
13. A modelled plant keeps publishing while telemetry is stopped and started again: every run-mode
    transition published during the outage is in telemetry's history with the machine's own time.
14. With a deliberately low queue ceiling the broker drops messages during an outage: when telemetry
    reconnects it logs `mqtt.broker.messages_dropped` with the number dropped.

### Capacity measurement (by hand)

`pnpm test:capacity` runs scenario 13 at the design load with a 30-minute outage and writes the
measured table described in [Broker buffering](#broker-buffering) to
`docs/operations/mqtt-broker-capacity.md`. It takes over half an hour, so CI does not run it.

Before implementation, these scenarios are extracted to `docs/test-scenarios/performance.md`.

## Rejected approaches

- **Periodic history reconciliation as the safety net.** Run the reconciler every minute and replay each
  work center's transitions from telemetry's history. One mechanism would recover points 1, 2, 4, 5 and
  6, but the candidate would have to move into MongoDB next to the cursor, two writers would update the
  same state, telemetry would be queried every minute, and point 3 would still need its own handling.
- **Pending decisions in MongoDB.** Keep the candidate and the after-planned check in the run-mode
  processing state document. Redis already persists them with AOF and the stream redelivers unfinished
  samples, so the gain is small; it would mostly move the same logic elsewhere.
- **Documenting the broker's limits instead of raising them.** A known gap would stay open, and the
  sizing does not need customer data: it needs an explicit load model and a measurement, both of which
  this design provides.

## What this design does not do

- It does not show the machine state while telemetry is down.
- It does not change what the debounce or the micro stop threshold mean.
- It does not add a dedicated "deleted" event; a deleted stop publishes `unplanned_stop.updated`, as a
  manual delete does today.
