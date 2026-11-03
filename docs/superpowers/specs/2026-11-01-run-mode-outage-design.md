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
- Telemetry publishes a sample it stores as `tag.value.recorded` with `previousOccurredAt`, the time of
  the tag's sample stored before it (null for its first). A consumer whose last processed sample is
  older than that knows it missed samples. Not every stored sample is published: a failed publish is
  logged (`events.publish.failed`, warn) and swallowed, and a write MongoDB applied but did not
  answer is retried, finds its own sample stored, and is dropped as out of order. Rule 6 replays
  both from the history with the tag's next published sample.
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
- It cannot be read, or work-center could not answer: a "check after planned stop" record
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
  after E gets a fresh check at its end, pending from the handover, with 25 hours of its own. A
  check dropped after 24 hours hands the key on the same way, so the checks refused while it waited
  are not lost with it. A check handed to a close that could read the run mode records the same stop
  again, which the unique start index refuses.
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
- the drop of a record undecided after 24 hours, with the handover of a check (rule 4);
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
- Telemetry does not know the tag, or answers that it is not binary: nothing is replayed and the signal
  is decided.

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
- A record still undecided 24 hours after it became pending is dropped with an error log
  (`run_mode.decision.abandoned`), because a stop may have been lost. A record becomes pending at its
  first write, by the server's clock (`pendingSince`); its retries keep that time, and a check handed
  on starts afresh. The stop's own time does not count, so the stop of a machine that has stood for
  days when its monitoring starts, or of a planned stop closed a day late with its earlier end, is
  still decided. A dropped check hands its key on to the next planned stop that closed after its E
  (rule 4), under the tag's lock, so a planned stop that closes meanwhile cannot lose its check in
  between. When that planned stop cannot be read, the drop waits for its next attempt on the same
  schedule. A 25-hour Redis TTL only clears orphaned keys.

### Tag map

- On a `work_center.*` event, work-center is read first. On success the mapping is updated, and the work
  center is reconciled when its tag changed or it is new. A work center is monitored when it is
  physical, active and has a run-mode tag, the same test work-center's monitor list applies; an
  archived or deleted work center is read like any other and stops being monitored.
- When work-center cannot answer, the old mapping stays and its signals keep being processed. The event
  is acknowledged, so it does not end up dead-lettered, and a full refresh starts.
- The full refresh reads the monitored work centers from work-center and retries until it succeeds, on
  the schedule above. It then updates the mapping and reconciles new or changed work centers. One
  refresh runs at a time: an event that comes while it runs leaves the work center to it, and the
  refresh reads the list once more when such an event came after its read.
- Startup maps the work centers that have a cursor before the stream consumer starts, so their signals
  are processed while work-center is down, and then runs the same refresh in the background.
- A work center reconciled by the tag map is retried on its own until it succeeds, as in boot
  reconciliation, with the same log lines.
- Logs mark changes, not attempts: `run_mode.tag_map.refresh_failed` (warn) at the refresh's first
  failure, with the cause, and `run_mode.tag_map.refresh_recovered` (info, with `attempts`) once it
  succeeds after failing. Its requests log their failures at debug.
- A work center stops being monitored when it loses its run-mode tag, its tag changes, or it leaves the
  monitor list. Its cursor and the old tag's pending decisions of both kinds are then deleted, under the
  tag's lock and after any reconciliation of that tag is cancelled, and `run_mode.tag_map.unmonitored`
  (info) is logged. The old tag never decides for the machine again, and monitoring that resumes starts
  from the latest sample: neither rule 6 nor the reconciler replays the time it was not monitored, which
  the performance service spec puts outside run-mode scope.
- A work center that is no longer monitored at all, because it was archived or deleted or lost its
  run-mode tag, also gets its open run-mode stop closed at the moment monitoring stops, by the server's
  clock, under the same lock, and the stop is kept; `run_mode.tag_map.unmonitored` names it
  (`closedStopId`). Nothing tells the stop's end after that moment, and an operator can still edit it.
  A work center whose tag changed keeps the stop open: the new tag's first running signal closes it.
- Only stopping monitoring deletes a cursor, so a replay that was asking telemetry when the cursor was
  deleted brings nothing back. A sample whose handling started from a cursor proceeds under the tag's
  lock only while that cursor exists; otherwise it decides nothing (`run_mode.sample.skipped`, debug),
  the replay ends there, and the signal that started rule 6's replay is not decided either. A sample
  handled with no cursor at its start is still the tag's first.
- Accepted boundary: at startup the map holds the tags the cursors name until the refresh answers, and
  boot reconciliation replays each of them. A tag that changed or was removed while performance was down
  therefore has its history replayed until the refresh stops monitoring it. The old mapping is kept on
  purpose while work-center cannot answer.
- The run-mode monitors client throws when work-center cannot answer, like the other internal clients,
  so a refresh tells "no monitors" from "could not read them". A successful answer without a `data`
  list throws the same way.
- Shutdown stops the refresh and the tag map's reconciliations before the data connections close, as it
  stops boot reconciliation.

### A run-mode tag that is not binary

Work-center binds any tag as a work center's run-mode tag, but only a binary one says whether the machine
runs. Validating the binding is work-center's concern.

- A `tag.value.recorded` sample whose `behavior` is present and not binary skips the run-mode rules.
  `run_mode.sample.not_binary` (warn, with `workCenterId`, `runModeTagId` and `behavior`) is logged once
  per tag, and again only after the tag has sent binary samples in between.
- Telemetry answers 400 `historian.binary_only` when asked for the states of such a tag. A pending check
  that gets this answer is dropped with `run_mode.decision.not_binary` (warn), as a 404 drops a decision
  with `unknown_tag`. Rule 6's replay and the reconciler treat it as a tag telemetry does not know:
  nothing is replayed, with no retry and no dead letter. Every other failed answer still counts as
  telemetry not answering.

### Boot reconciliation

Each work center is retried on its own until it succeeds. It runs in the background so it does not hold
up startup. Telemetry being down at boot only delays it.

- A work center with a cursor replays telemetry's history since it through rule 6's paging loop. A
  replay that reaches its page limit goes on from the cursor its samples advanced until it reaches
  the attempt's time; one that advanced nothing fails and waits for its next attempt.
- Boot reconciliation lists the work centers that have a cursor. One whose cursor is gone by the time it
  is reconciled stopped being monitored and is skipped (`run_mode.reconciler.skipped`, debug); it never
  starts from its latest sample.
- A work center without a cursor starts from telemetry's latest sample, and only while the tag still
  has no cursor under the tag's lock: a stopped one goes through rule 1, a running one only sets the
  cursor. A cursor the event path wrote while telemetry was asked means it has taken the tag over,
  with rule 6 for anything it missed, so the reconciliation decides and writes nothing. Moving the
  cursor to the latest sample would skip the samples the event path has not processed yet, and a
  skipped running signal would leave its candidate undecided.
- The retries follow the schedule of pending decisions. Logs mark changes, not attempts:
  `run_mode.reconciler.failed` (warn) at a work center's first failure, with the cause, and
  `run_mode.reconciler.recovered` (info, with `attempts`, the failed ones) once it succeeds after
  failing. Its telemetry requests log no line of their own at warn.
- Shutdown stops it before the data connections close: retries still waiting are cancelled, requests
  in flight are aborted, and a replay stops before its next sample once the one being written is
  written.

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
- A broker crash loses the messages it queued since its last autosave: up to one `autosave_interval`
  of the queue. The broker restarts from its last save, and nothing counts what was lost.
- A telemetry crash loses the messages it acknowledged and had not yet stored: at most
  `MQTT_MAX_UNSTORED_MESSAGES` − 1.
- A telemetry stop or crash while MongoDB is unreachable loses the messages waiting for it that
  telemetry had acknowledged: at most `MQTT_MAX_UNSTORED_MESSAGES` − 1. A stop logs each one it gives
  up as `ingestion.store.abandoned`.
- A store that fails for any reason other than an unreachable MongoDB, MongoDB rejecting the document
  for example, drops its message, logged as `ingestion.error`.
- A stop decided by a dead-lettered sample, such as one in flight while performance could not write
  to MongoDB, shows only at its tag's next sample, when rule 6 replays it.
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
  `86400`.
  - The session outlives the queue ceiling by far: at the design load the ceiling fills in
    37.6 minutes. An outage longer than the ceiling allows therefore ends with the broker dropping
    messages, which it counts and telemetry alerts on (see
    [When an outage runs longer](#when-an-outage-runs-longer)), not with the session expiring, which
    discards the whole queue and counts nothing.
  - A day still bounds how long an orphaned session lives (one left behind by a changed client id),
    and how long the broker keeps writing a full queue at every autosave.
- **Telemetry's intake:** `MQTT_MAX_UNSTORED_MESSAGES` bounds the messages telemetry has received but
  not yet stored. Its default, 20, comes from the capacity measurement: it is the smallest bound at
  which telemetry, within its 0.5 CPU, stored a backlog fastest. A bound of 1000 stored half as
  fast, because the many concurrent stores cost CPU of their own.
  - Below the bound, telemetry acknowledges each message as it arrives and stores it afterwards, as
    before. MQTT.js handles one incoming message at a time, so acknowledging only after each store
    would serialize storage below the plant's rate.
  - At the bound, telemetry holds back the next acknowledgement until a store finishes. MQTT.js then
    stops reading, and the rest of the backlog stays at the broker, which is sized for it. Without the
    bound the broker hands its whole queue to a reconnecting telemetry within seconds, and telemetry
    held 2 GB of it in memory in the measurement, four times its container limit.
  - A store or tag lookup that fails because MongoDB cannot be reached (the driver's server-selection
    or network error) keeps its place and tries again after 1 s, doubling, at most 30 s apart, with no
    give-up while the error lasts. The messages after it for the
    same node wait behind it, so the intake holds at its bound and the broker keeps the rest until
    MongoDB is back. Telemetry logs `ingestion.store.deferred` (warn) once when a message first waits
    and `ingestion.store.resolved` (info, with `waitedMs`) once it is handled, however: stored, or
    dropped because no tag is bound to its node or its payload is bad; no line per attempt. A message
    a stop abandons gets `ingestion.store.abandoned` instead.
  - Any other failed store drops its message with `ingestion.error` and frees its place. A manual
    entry over HTTP is not retried: with MongoDB unreachable it fails, unless an MQTT message of its
    tag is waiting ahead of it, in which case it waits in the tag's order too.
  - A store that waits longer than the MQTT keepalive, for a MongoDB that is down or a dependency that
    does not answer, holds MQTT.js's reading too: the keepalive times out, telemetry reconnects with
    its session and logs an error line, about every 100 s while the wait lasts. The broker delivers
    the held-back message again on each reconnect, and each delivery is one more store of it, waiting
    in its node's order: about 864 a day while MongoDB stays down. Once MongoDB is back, the first
    store keeps the message and each extra one is dropped as `ingestion.sample.out_of_order` (warn).
    Telemetry acknowledges none of the extra deliveries, so a crash still loses at most
    `MQTT_MAX_UNSTORED_MESSAGES` − 1 messages.
  - At startup telemetry exits when its subscriptions fail, and a wait that holds the intake while it
    starts into a backlog fails them through the keepalive. Docker starts telemetry again, the exit
    repeats about every 100 s while the wait lasts, and each exit is a crash: it loses at most
    `MQTT_MAX_UNSTORED_MESSAGES` − 1 acknowledged messages. With MongoDB unreachable at startup,
    telemetry exits before it connects to the broker and takes nothing in.
  - A telemetry crash loses at most `MQTT_MAX_UNSTORED_MESSAGES` − 1 messages: the ones it
    acknowledged and had not stored. A message it holds back is not acknowledged, and the broker
    delivers it again.
  - A clean stop takes nothing more in and acknowledges nothing more, lets the stores in progress
    finish, and only then closes MongoDB and Redis. The broker delivers again what was still
    arriving. Stores that wait for an unreachable MongoDB stop waiting at once, so they do not hold
    the stop past its grace period: each logs `ingestion.store.abandoned` (error), and the stop loses
    what a crash would.
- **Broker** (`infra/mosquitto/mosquitto.conf`): `max_queued_messages 0`, so the message count is no
  longer the limit, and `max_queued_bytes` as the hard ceiling for the queue. Its value is the measured
  queue size of a 30-minute outage at the design load, plus 25%.
- **Broker container:** a memory limit computed from the same measurement, so that a full queue
  never gets the broker killed. With the session outliving the ceiling, a longer outage fills the
  queue to the ceiling, so the memory limit covers a queue at the ceiling: the measured memory per
  queued message × the messages the ceiling holds × 1.25. No run holds a queue at the ceiling, so
  this limit is computed, not measured. The CPU limit is the one the measurement ran under: a CPU
  measured under a cap cannot show demand above it.
- **`autosave_interval`**, which bounds what a broker crash loses, is chosen from the measured cost of
  writing a full queue to disk.

### Proof

- **In CI (e2e):** a modelled plant publishes while telemetry is stopped and started again. Every
  run-mode transition published during the outage ends up in telemetry's history with the machine's own
  time. The e2e broker runs the repository's `mosquitto.conf` with only authentication changed, so the
  test exercises the production settings. The harness runs services as separate processes, so the
  process id changes on restart and the stable client id is proven as well.
- **By hand (`pnpm test:capacity`):** the same plant at the design load with a 30-minute outage, with
  the broker's final settings and container limits, and telemetry and performance as containers built
  from their Dockerfiles under their `docker-compose.yml` limits.
  - It records the broker's peak memory, its message store size, the persistence file size, and how
    long telemetry takes to work off the backlog once it is back. Telemetry has to ingest faster than
    the 500 messages/s still arriving, within its CPU and memory limits.
  - The results go into `docs/operations/mqtt-broker-capacity.md` as a table, with the method, the
    assumptions and the commands to repeat it for another rate.

### When an outage runs longer

Once the ceiling is reached the broker drops new messages, and that must not go unseen. When telemetry
connects it reads the broker's dropped-message counter (`$SYS/broker/publish/messages/dropped`),
compares it with the value it saw last, and logs `mqtt.broker.messages_dropped` at error level with the
difference. A file-provisioned Grafana alert rule fires on that event. The broker restarting resets the
counter; telemetry then takes the new value as its baseline. Stops across such an outage still follow
the decision rules, with whatever signals survived.

A session that expires takes its whole queue with it, and the broker counts none of it as dropped.
Telemetry's session outlives the ceiling, so at the design load that needs an outage of a day. A
broker that loses its sessions does the same: one restarted without its persistence file, or one
whose memory was cleared. Either loss must not go unseen either.

- Telemetry keeps a marker in its Redis once it has had a session, the same way as the dropped-message
  baseline.
- When it connects and the broker answers that it has no session for it, while the marker says it had
  one, telemetry logs `mqtt.session.lost` at error level. A second Grafana alert rule fires on that.
- A first connect ever has no marker, and logs nothing.

## Data and configuration changes

- **Redis**
  - `runmode:candidate:{workCenterId}:{runModeTagId}` gains `pendingSince`, `attempts` and
    `nextAttemptAt`; its TTL becomes 25 hours.
  - New `runmode:after-planned:{workCenterId}:{runModeTagId}`:
    `{ since, pendingSince, attempts, nextAttemptAt }`, same TTL. It holds the earliest pending E; a
    decided check hands the key to the next planned stop that closed after E (rule 4).
- **MongoDB:** unique index on unplanned stops `{ workCenterId: 1, startAt: 1 }` with the partial filter
  `{ source: 'run_mode' }`. The product is not released, so there is no migration; a local database that
  already holds two run-mode stops with the same start must be cleaned before the index can build.
- **Telemetry config:** `MQTT_CLIENT_ID`, default `aimes-telemetry`; `MQTT_SESSION_EXPIRY_SECONDS`,
  default `86400`; `MQTT_MAX_UNSTORED_MESSAGES`, default `20`, from the capacity measurement.
- **Telemetry's Redis:** `mqtt:session` marks that telemetry has had a broker session.
- **Telemetry event:** `tag.value.recorded` gains `previousOccurredAt`, the ISO 8601 UTC time of the
  tag's previous stored sample, or null for its first.
- **Broker:** `max_queued_messages 0`, `max_queued_bytes` and `autosave_interval` in
  `infra/mosquitto/mosquitto.conf`, and the broker's memory and CPU limits in `docker-compose.yml`, all
  set from the capacity measurement.

## Components

| Component | Change |
|---|---|
| `performance/src/modules/run-mode/run-mode.processor.ts` | Rules 1, 2 and 6, deleting a stop shorter than D, the replay loop rule 6 and the reconciler share, `now` parameter; a planned stop that has closed since covers a late signal; rule 4 at the close, the check's end at the next planned stop's start and its handover; a handling that started from a cursor decides nothing once that cursor is gone |
| `performance/src/modules/run-mode/run-mode.decisions.ts` | Pending decision records in Redis: keys, first-write-wins candidates, the earliest pending check in one step, compare-and-set on `since` for deferrals, decisions and the handover with a TTL of its own, the retry schedule, the 24-hour drop under the tag's lock with the handover of a check |
| `performance/src/modules/run-mode/run-mode.debounce-tick.ts` | Rule 3, after-planned checks, retry schedule, 24-hour limit |
| `performance/src/modules/run-mode/run-mode.reconciler.ts` | Retry per work center in the background, stopped at shutdown; replays through the shared loop, past its page limit; a tag without a cursor starts from its latest sample only while it still has none, under the tag's lock; a work center listed from its cursor is skipped once that cursor is gone |
| `performance/src/lib/internal-api/run-mode-telemetry.client.ts` | State-durations segments in the shape telemetry answers (`state`, `start`, `end`); a caller's signal aborts a request before its timeout |
| `performance/src/modules/planned-stop/planned-stop.service.ts` | Rule 4: the run-mode tag from work-center or the cursor; leave a check when the run mode cannot be read; a failed check does not fail the close |
| `performance/src/modules/unplanned-stop/` | Insert a closed run-mode stop, unique index, duplicate counts as recorded; no close ends a stop before it starts |
| `performance/src/jobs/subscribers.ts` | Every `work_center.*` event goes to the tag map; pass `previousOccurredAt` on; skip a run-mode sample that is not binary, with one warning per tag |
| `performance/src/jobs/tag-map.ts` | Read work-center before changing the map, full refresh with retries, seeded from the cursors at startup; a work center that stops being monitored loses its cursor and pending decisions; new and changed work centers reconciled with retries; stopped at shutdown |
| `performance/src/lib/internal-api/run-mode-monitors.client.ts` | Throw when work-center cannot answer; the caller's log level and abort signal |
| `performance/src/lib/internal-api/telemetry-request.client.ts` | A 400 `historian.binary_only` is its own error, not telemetry being unreachable |
| `telemetry/src/lib/mqtt.ts`, telemetry config | Client id and session expiry from config; dropped-message check on connect; a bound on messages received but not stored; a lost session logged on connect |
| `telemetry/src/app.ts`, `telemetry/src/core/loaders/index.ts` | Shutdown stops the intake, ends the waits for an unreachable MongoDB, and lets the stores finish before it closes MongoDB and Redis |
| `telemetry/src/jobs/events.ts`, `telemetry/src/modules/ingestion/ingestion.pipeline.ts` | `tag.value.recorded` carries the previous stored sample's time; a store or tag lookup that cannot reach MongoDB waits for it in the node's and the tag's order |
| `infra/mosquitto/mosquitto.conf`, `docker-compose.yml` | Queue ceiling, autosave interval, broker memory and CPU limits |
| `infra/grafana/provisioning/alerting/` | Alert rules on `mqtt.broker.messages_dropped` and `mqtt.session.lost` |
| `packages/testing` | Redis test container helper using the image docker-compose.yml runs |
| `e2e/src/global-setup.ts` | Stop and start a service during a test; run the repository's broker config; for the capacity measurement, run services as containers from their Dockerfiles and the broker and those services under their compose limits |
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
   planned stop that covered it closed leaves the check at its end, whichever rule meets it, also
   when a planned stop that never started overlaps that one. A planned stop closed late, with an
   earlier end, leaves the check when its latest sample came after E: the check records `[E, T1]`
   when the machine stood at E and opens nothing at E when it ran then, and it decides the stops the
   planned stop covered after E (a machine down since 10:35 gets its stop at 10:35, a short stop
   below D gets none). At an end that another planned stop covers, neither the close nor the check
   records anything, and the check still hands the key on.
8. Retries come after 1, 2, 4 … 30 s; only the deferred and resolved lines are logged; 24 hours after
   it became pending the record is dropped with an error log, while a record for a stop older than a
   day that has just become pending is still decided; a dropped check hands its key on to the next
   planned stop that closed after its end, under the tag's lock: a planned stop that closes meanwhile
   keeps its check, and a handover that cannot read the planned stops waits for its next attempt.
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

### Telemetry against a real broker

These tests run against a real Mosquitto in a test container.

15. Telemetry reconnects to a backlog larger than `MQTT_MAX_UNSTORED_MESSAGES`, and its stores are slow:
    - it never holds more received but unstored messages than the bound;
    - while it is at the bound, the broker still has the rest of the backlog;
    - once the stores finish, every message has been handed to a store once, in the order it was
      published, and stored once.
16. A store that fails frees its place in the bound.
17. Telemetry connects and the broker has no session for it:
    - when telemetry has had one, it logs `mqtt.session.lost`;
    - on its first connect ever, it logs nothing;
    - when the broker kept the session, it logs nothing.
18. Telemetry closes while a machine publishes fast: it takes in nothing more after it starts to
    close, logs no MQTT error, and after a reconnect every message has arrived.
19. Telemetry's MongoDB, a standalone server in a test container, stops while a machine publishes and
    starts again:
    - every message is stored once and in the order published, the first messages of a tag not
      looked up yet included, and the broker holds what telemetry has not taken in meanwhile;
    - a message MongoDB rejects is dropped with `ingestion.error`, and the ones after it are stored;
    - telemetry stopping while MongoDB is down ends the waits at once and logs one
      `ingestion.store.abandoned` per message it gives up.

### Capacity measurement (by hand)

`pnpm test:capacity` runs scenario 13 at the design load with a 30-minute outage and writes the
measured table described in [Broker buffering](#broker-buffering) to
`docs/operations/mqtt-broker-capacity.md`. It runs the broker with its final settings and container
limits, and telemetry and performance as containers under their compose limits. It takes over half an
hour, so CI does not run it.

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
