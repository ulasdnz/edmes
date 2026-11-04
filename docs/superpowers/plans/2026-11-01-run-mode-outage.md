# Run-Mode Stops Through Outages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every run-mode stop when telemetry or work-center cannot answer for a while or signals
arrive late, and let the MQTT broker bridge a 30-minute telemetry outage, with the capacity measured.

**Architecture:** The event flow, the Redis candidate and the 1 s tick stay. Pending decisions stop
expiring and retry on a fixed schedule; every decision uses the machine's own signal times; a unique
index makes concurrent writers safe. Telemetry keeps one MQTT session across restarts and the broker
queue is sized from a documented load model and a reproducible measurement.

**Tech Stack:** TypeScript (ESM, NodeNext), Express 5, Mongoose 9, ioredis 5, mqtt.js 5, Mosquitto 2.1,
Vitest 4 with testcontainers, Grafana file provisioning.

**Spec:** `docs/superpowers/specs/2026-11-01-run-mode-outage-design.md`

## Global Constraints

- Imports use `.js` extensions; services extend `tsconfig.app.json`.
- Every log call: message string first, an `event` field in dot notation.
- Instants are `Date` in code and ISO 8601 with `Z` in Redis records and on the wire.
- New tests run on real infrastructure: MongoDB and Redis in test containers with the images
  `docker-compose.yml` runs (`MONGO_IMAGE`, `REDIS_IMAGE`), other services as real HTTP stub servers.
  No mock of Redis or MongoDB in the new contract tests.
- Retry schedule: 1, 2, 4, 8 and 16 s, then every 30 s. A decision still open after 24 hours is
  dropped. Redis TTL of a pending record: 25 hours.
- Log events: `run_mode.decision.deferred` (warn, first failure), `run_mode.decision.resolved` (info,
  with `waitedMs`), `run_mode.decision.abandoned` (error), `run_mode.decision.unknown_tag` (warn),
  `mqtt.broker.messages_dropped` (error, with `dropped`).
- Broker target: a telemetry outage of up to 30 minutes at 500 messages/s of about 150 bytes loses no
  message. `MQTT_CLIENT_ID` defaults to `aimes-telemetry`, `MQTT_SESSION_EXPIRY_SECONDS` to `1800`,
  `max_queued_messages` is `0`, `max_queued_bytes` is the measured queue size plus 25%.
- Not released: no migrations or backfills.
- Commits are conventional with a lowercase subject and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never stage the context-mode section of
  `CLAUDE.md`. **Commit only after the user approves.**

## Review Focus

These conditions are not named by the spec's scenarios; each line's test is added to the task that owns
the code.

1. **A machine clock ahead of the server.** A stop stamped in the future must not be confirmed before the
   server clock reaches `T0 + D`. Test in Task 5.
2. **Telemetry that hangs instead of refusing.** A request that never answers must count as "cannot
   answer" within 5 s and must not hold up the decisions of other work centers. Test in Task 5.
3. **A run-mode tag that changes while a decision is pending.** Pending decisions of the old tag are
   dropped, so the old tag never decides for the machine. Test in Task 8.
4. **The same stopped sample delivered twice** (stream redelivery after a crash). One candidate, with the
   first stop time. Test in Task 4.
5. **The debounce changing while a candidate is pending.** The candidate keeps the debounce it started
   with. Test in Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `performance/src/modules/run-mode/run-mode.decisions.ts` (new) | Pending decision records in Redis: keys, read and write, retry schedule, 24-hour limit, logs |
| `performance/src/modules/run-mode/run-mode.processor.ts` | Rules 1 and 2 |
| `performance/src/modules/run-mode/run-mode.debounce-tick.ts` | The tick: rule 3 and the after-planned checks |
| `performance/src/modules/run-mode/run-mode.reconciler.ts` | Per work center reconciliation, retried in the background |
| `performance/src/modules/unplanned-stop/unplanned-stop.{model,service}.ts` | Unique run-mode start, closed insert, close or discard on a running signal |
| `performance/src/modules/planned-stop/planned-stop.service.ts` | Rule 4: leave a check when the run mode cannot be read |
| `performance/src/jobs/subscribers.ts` + `performance/src/jobs/tag-map.ts` (new) | Tag map: read before changing, full refresh with retries |
| `performance/src/lib/internal-api/*.client.ts` | Monitors client throws; telemetry requests time out |
| `telemetry/src/config/index.ts`, `telemetry/src/lib/mqtt.ts`, `telemetry/src/lib/mqtt-dropped.ts` (new) | Client id, session expiry, dropped-message check |
| `infra/mosquitto/mosquitto.conf`, `docker-compose.yml` | Queue ceiling, autosave interval, broker limits |
| `infra/grafana/provisioning/alerting/mqtt-broker.yml` (new) | Alert on `mqtt.broker.messages_dropped` |
| `packages/testing/src/images.ts` | `REDIS_IMAGE` |
| `e2e/src/global-setup.ts`, `e2e/src/support/services.ts` (new) | Repository broker config, stop and start a service |
| `e2e/src/capacity/` (new), `e2e/vitest.capacity.config.ts` (new) | The 30-minute measurement |
| `docs/operations/mqtt-broker-capacity.md` (new) | Measured table, method, assumptions |

---

### Task 1: Extract the test scenarios

**Files:**
- Modify: `docs/test-scenarios/telemetry.md`
- Create: `docs/test-scenarios/performance.md`

- [ ] **Step 1:** Invoke the `extract-test-scenarios` skill with the spec and this plan. Scenarios 1-12
  and the Review Focus lines go to `performance.md`, 13 and 14 to `telemetry.md`.
- [ ] **Step 2:** Check that every numbered scenario of the spec and every Review Focus line appears
  once, with its test file.
- [ ] **Step 3: Commit** after the user approves: `docs: list the run-mode outage test scenarios`.

### Task 2: Test infrastructure

**Files:**
- Modify: `packages/testing/src/images.ts`, `packages/testing/src/index.ts`
- Modify: `performance/src/test/contract-global-setup.ts`
- Modify: `e2e/src/global-setup.ts`
- Create: `e2e/src/support/services.ts`, `e2e/src/harness.e2e.test.ts`

**Interfaces:**
- Produces: `REDIS_IMAGE: string` from `@mes/testing` (the compose image, digest kept; Redis has no
  version-parsing module like MongoDB's).
- Produces: `stopService(name: ServiceName): Promise<void>` and
  `startService(name: ServiceName): Promise<void>` in `e2e/src/support/services.ts`. They call a control
  server that global setup runs on `127.0.0.1` and provides as `inject('control')`:
  `POST /services/:name/stop` resolves once the process has exited, `POST /services/:name/start` once
  the service answers its readiness check on the same port.

- [ ] **Step 1: Write the failing test** `e2e/src/harness.e2e.test.ts`:
  `it('restarts a service on the same address')` stops telemetry, expects its health URL to refuse,
  starts it, expects `GET /health/ready` to answer 200.
- [ ] **Step 2:** `pnpm test:e2e` → FAIL (`inject('control')` is undefined).
- [ ] **Step 3: Implement.**
  - `REDIS_IMAGE = composeImage('redis')`.
  - The contract global setup starts `new GenericContainer(REDIS_IMAGE)` instead of `redis:7`.
  - The e2e broker config is `infra/mosquitto/mosquitto.conf` with `allow_anonymous false` turned true
    and the `password_file` line removed, so e2e runs the production queue and persistence settings.
  - A service stopped through the control server is not reported as crashed; teardown stops the
    process that runs at that moment.
- [ ] **Step 4:** `pnpm test:e2e` → PASS, 12 tests. `pnpm --filter performance-service test:contract`
  → PASS.
- [ ] **Step 5: Commit** after approval: `test: run the production broker config in e2e and restart services`.

### Task 3: Unplanned stops written once, closed in one write

**Files:**
- Modify: `performance/src/modules/unplanned-stop/unplanned-stop.model.ts`
- Modify: `performance/src/modules/unplanned-stop/unplanned-stop.service.ts`
- Test: `performance/src/modules/unplanned-stop/unplanned-stop.service.test.ts`

**Interfaces:**
- Produces: `recordClosedFromRunMode(workCenterId: string, startAt: Date, endAt: Date): Promise<IUnplannedStop>`
  inserts the stop already closed, gives it `MICRO_STOP` when it lasts no longer than the policy's
  `microStopThresholdMs` (the rule `closeIfOpen` applies), publishes the opened then the closed event,
  and returns the existing stop when one with the same start is already recorded.
- Produces: `closeOnRunning(workCenterId: string, endAt: Date, debounceMs: number): Promise<IUnplannedStop | null>`
  closes the open stop at `endAt`. A run-mode stop with `updatedBy` null that would last less than
  `debounceMs` is deleted through the path `remove` uses (publishes `unplanned_stop.updated`) and
  `null` is returned.
- Changes: `openFromRunMode` returns the run-mode stop with the same `(workCenterId, startAt)` when the
  new index refuses the insert.
- Index: `{ workCenterId: 1, startAt: 1 }`, unique, `partialFilterExpression: { source: 'run_mode' }`.

- [ ] **Step 1: Write the failing tests:**
  - `records a closed run-mode stop once when it is written twice`: two calls with the same start →
    one document, both calls return its `_id`.
  - `marks a recorded stop no longer than the micro stop threshold as a micro stop`: 90 s with the
    default 120 000 ms threshold → `reasonId` is the `MICRO_STOP` reason.
  - `leaves an open manual stop open when it records a closed run-mode stop`.
  - `returns the recorded stop when a run-mode stop with the same start is opened again`.
  - `deletes an untouched run-mode stop that ends shorter than the debounce`: opened at 10:00:00,
    `closeOnRunning(..., 10:00:20, 60_000)` → `null`, no document.
  - `closes and keeps a short run-mode stop a user has changed`: same, with `updatedBy` set → closed.
  - `closes a manual stop on a running signal whatever its length`.
- [ ] **Step 2:** `pnpm --filter performance-service exec vitest run src/modules/unplanned-stop` →
  the new tests FAIL (functions missing).
- [ ] **Step 3: Implement** the index and the two functions; extend `openFromRunMode`'s duplicate path.
- [ ] **Step 4:** Same command → PASS; the whole performance unit suite → PASS.
- [ ] **Step 5: Commit** after approval: `fix: write each run-mode stop once and close late ones in one write`.

### Task 4: Pending decision records and rules 1-2

**Files:**
- Create: `performance/src/modules/run-mode/run-mode.decisions.ts`
- Modify: `performance/src/modules/run-mode/run-mode.processor.ts`
- Create: `performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts`

**Interfaces:**
- Produces in `run-mode.decisions.ts`:
  - `interface PendingDecision { kind: 'debounce' | 'after_planned'; since: string; debounceMs: number; attempts: number; nextAttemptAt: string | null }`
    (`since` is T0 for a debounce candidate and E for an after-planned check; `debounceMs` is 0 for the
    latter).
  - `decisionKey(kind, workCenterId, runModeTagId): string` → `runmode:candidate:{wc}:{tag}` or
    `runmode:after-planned:{wc}:{tag}`.
  - `readDecision`, `writeDecision` (TTL 90 000 s), `deleteDecision`.
  - `retryDelayMs(attempts: number): number` → 1000, 2000, 4000, 8000, 16 000, then 30 000.
  - `DECISION_LIMIT_MS = 86_400_000`.
- Consumes: `recordClosedFromRunMode`, `closeOnRunning` (Task 3).
- Contract test file: starts stub servers for work-center (port 19902) and telemetry (port 19904) with a
  switch per endpoint between answering, `500`, and never answering; wipes Redis keys between tests.

- [ ] **Step 1: Write the failing tests** (D = 60 s unless stated):
  - `records the stop when the running signal shows it outlasted the debounce`: 0@10:00, 1@10:05 with the
    telemetry stub down → stop `[10:00, 10:05]`, no candidate left.
  - `records nothing when the running signal shows the stop was shorter`: 0@10:00, 1@10:00:20 → no stop.
  - `records only the stop that outlasted the debounce in a burst`: 0@10:00, 1@10:00:20, 0@10:00:40,
    1@10:03 → exactly `[10:00:40, 10:03]`.
  - `deletes an untouched stop the late running signal shows was too short`: open at 10:00 through
    `openFromRunMode`, 1@10:00:20 → no stop.
  - `keeps one candidate with its first stop time when a stopped sample arrives twice` (Review Focus 4).
  - `keeps the debounce a candidate started with when the policy changes` (Review Focus 5): candidate
    with D = 60 s, policy set to 300 s, 1@10:02 → stop recorded.
- [ ] **Step 2:** `pnpm --filter performance-service test:contract` → the new tests FAIL.
- [ ] **Step 3: Implement** `run-mode.decisions.ts`; the processor writes `PendingDecision` records and
  rule 2 calls `recordClosedFromRunMode` when `T1 − T0 ≥ debounceMs` of the record (unless a planned
  stop covers T0), then `closeOnRunning(workCenterId, T1, debounceMs)`.
- [ ] **Step 4:** Contract suite → PASS; performance unit suite → PASS (update
  `run-mode.processor.test.ts` only where it asserts the old TTL of `debounce + 2 s`).
- [ ] **Step 5: Commit** after approval: `fix: keep run-mode stops that a late running signal proves`.

### Task 5: The tick decides with retries

**Files:**
- Modify: `performance/src/modules/run-mode/run-mode.debounce-tick.ts`, `run-mode.processor.ts`
- Modify: `performance/src/lib/internal-api/telemetry-request.client.ts`
- Test: `performance/src/modules/run-mode/__contract__/run-mode-outage.contract.test.ts`

**Interfaces:**
- Changes: `confirmCandidate(target: ConfirmationTarget, now: Date = new Date()): Promise<void>`.
- Produces: `confirmAfterPlannedCheck(target: ConfirmationTarget, now: Date = new Date()): Promise<void>`
  reads `getStateDurations(tag, since, now)`: stopped at `since` → `recordClosedFromRunMode(wc, since,
  first running segment's from)`, or `openFromRunMode(wc, since)` when no running segment follows;
  running at `since` → nothing; the record is deleted either way.
- Produces: `runDecisionTick(now: Date): Promise<void>` scans both key prefixes; `startDebounceTick`
  calls it every second.
- Telemetry requests abort after 5000 ms (`AbortSignal.timeout`) and then count as "cannot answer".

- [ ] **Step 1: Write the failing tests:**
  - `opens the stop at its first stop time once telemetry is back` (scenario 1): telemetry down at
    T0 + D; back at T0 + 10 min with latest = the T0 sample → stop starts at T0.
  - `waits for the signal when telemetry knows a newer sample` (scenario 4) → no stop, candidate kept.
  - `writes one stop when the tick and a running signal decide together` (scenario 5).
  - `records the stop after a planned stop once telemetry is back` (scenario 7): check since E, stopped
    at E, running at E + 4 min → `[E, E + 4 min]`; a second test, running at E → nothing.
  - `retries on schedule and logs only the deferral and the decision` (scenario 8): attempts at +1, +2,
    +4, +8, +16, +30 s; one `run_mode.decision.deferred`, one `run_mode.decision.resolved`.
  - `drops a decision after 24 hours with an error log` (scenario 8).
  - `decides a candidate written before a restart` (scenario 11): write the record, run the tick from a
    fresh module instance (`vi.resetModules`).
  - `does not confirm a stop stamped ahead of the server clock` (Review Focus 1).
  - `decides other work centers while telemetry hangs for one` (Review Focus 2): one tag's stub never
    answers; the other work center's stop opens within the same tick plus 5 s.
- [ ] **Step 2:** Contract suite → the new tests FAIL.
- [ ] **Step 3: Implement** rule 3 as the spec states, the after-planned check, the retry fields, the
  24-hour limit and the request timeout. A 404 deletes the record with `run_mode.decision.unknown_tag`.
- [ ] **Step 4:** Contract suite → PASS; performance unit suite → PASS.
- [ ] **Step 5: Commit** after approval: `fix: retry run-mode decisions until telemetry answers`.

### Task 6: A planned stop that closes blind leaves a check

**Files:**
- Modify: `performance/src/modules/planned-stop/planned-stop.service.ts`
- Test: `performance/src/modules/planned-stop/planned-stop.service.test.ts`

**Interfaces:**
- Consumes: `writeDecision` (Task 4).
- Changes: when the run mode cannot be read, `maybeOpenUnplannedAfterClose` writes the record
  `{ kind: 'after_planned', since: actualEndAt.toISOString(), debounceMs: 0, attempts: 0, nextAttemptAt: null }`
  for the work center's run-mode tag. The tag comes from
  work-center, or from the work center's `RunModeProcessingState` when work-center cannot answer. With
  neither it logs `planned_stop.run_mode_unmonitored` (warn) and returns.

- [ ] **Step 1: Write the failing tests:**
  - `leaves a check when telemetry cannot be reached after a planned stop`.
  - `finds the run-mode tag from its cursor when work-center cannot be reached`.
- [ ] **Step 2:** `pnpm --filter performance-service exec vitest run src/modules/planned-stop` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Same command → PASS, including the two close tests added on 2026-11-01.
- [ ] **Step 5: Commit** after approval: `fix: check the run mode after a planned stop once telemetry is back`.

### Task 7: Boot reconciliation retries in the background

**Files:**
- Modify: `performance/src/modules/run-mode/run-mode.reconciler.ts`,
  `performance/src/core/loaders/index.ts`, the shutdown sequence
- Test: `performance/src/modules/run-mode/run-mode.reconciler.test.ts`

**Interfaces:**
- Consumes: `retryDelayMs` (Task 4).
- Produces: `reconcileWorkCenter(target: MonitoredWorkCenter, now: Date = new Date()): Promise<void>`,
  which throws when telemetry cannot answer (today's `reconcileOne` swallows it).
- Produces: `startBootReconciliation(): void` and `stopBootReconciliation(): void`. Each monitored work
  center retries on `retryDelayMs` until it succeeds. The loaders call `startBootReconciliation()`
  instead of `await reconcileOnBoot()`; shutdown calls `stopBootReconciliation()`.

- [ ] **Step 1: Write the failing test** `retries a work center until telemetry answers` (scenario 10).
- [ ] **Step 2:** Run it → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Performance unit and contract suites → PASS.
- [ ] **Step 5: Commit** after approval: `fix: retry boot reconciliation until telemetry answers`.

### Task 8: Tag map survives work-center outages

**Files:**
- Create: `performance/src/jobs/tag-map.ts`, `performance/src/jobs/tag-map.test.ts`
- Modify: `performance/src/jobs/subscribers.ts`
- Modify: `performance/src/lib/internal-api/run-mode-monitors.client.ts` and its test

**Interfaces:**
- Consumes: `retryDelayMs`, `deleteDecision` (Task 4), `reconcileWorkCenter` (Task 7).
- Changes: `listRunModeMonitors()` throws `CustomError(503, 'error.work_center_unreachable')` on a
  server error or network failure; an empty `data` still returns `[]`.
- Produces in `tag-map.ts`: `workCenterForTag(tagId: string): string | undefined`,
  `syncWorkCenter(workCenterId: string): Promise<void>`, `requestRefresh(): void`,
  `stopRefresh(): void`. `syncWorkCenter` reads work-center first; on failure it keeps the mapping and
  calls `requestRefresh()`. `requestRefresh` runs one refresh loop at a time on `retryDelayMs` until
  `listRunModeMonitors` answers, then replaces the mapping. Every work center that is new or whose tag
  changed is reconciled with `reconcileWorkCenter`, and the pending decisions of a changed tag are
  deleted.
- `subscribers.ts` keeps the stream handlers and calls `tag-map.ts`; startup seeds from cursors and
  calls `requestRefresh()`; shutdown calls `stopRefresh()`.

- [ ] **Step 1: Write the failing tests** (`tag-map.test.ts`, client mocked per call outcome):
  - `keeps the mapping when work-center cannot answer an update` (scenario 9).
  - `updates the mapping and reconciles once work-center answers again` (scenario 9).
  - `retries the monitor list at startup until it arrives` (scenario 10).
  - `drops pending decisions of a tag that changed` (Review Focus 3).
  - Monitors client: `fails with 503 when work-center answers with an error` and `… cannot be reached`.
- [ ] **Step 2:** Run them → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Performance unit and contract suites → PASS.
- [ ] **Step 5: Commit** after approval: `fix: keep the run-mode tag map through work-center outages`.

### Task 9: Telemetry keeps its session and reports dropped messages

**Files:**
- Modify: `telemetry/src/config/index.ts`, `telemetry/src/lib/mqtt.ts`
- Create: `telemetry/src/lib/mqtt-dropped.ts`, `telemetry/src/lib/mqtt.broker.test.ts`
- Create: `infra/grafana/provisioning/alerting/mqtt-broker.yml`

**Interfaces:**
- Config: `MQTT_CLIENT_ID: z.string().min(1).default('aimes-telemetry')`,
  `MQTT_SESSION_EXPIRY_SECONDS: z.coerce.number().int().positive().default(1800)`.
- Produces: `checkDroppedMessages(counter: number): Promise<void>` in `mqtt-dropped.ts`. The baseline
  lives in telemetry's Redis under `mqtt:dropped-baseline`, so it survives telemetry restarts. A counter
  above the baseline logs `mqtt.broker.messages_dropped` (error, `dropped` = difference); a counter
  below it (the broker restarted) only moves the baseline. `mqtt.ts` subscribes to
  `$SYS/broker/publish/messages/dropped` on connect and passes each value to it.
- Alert rule: Loki query `sum(count_over_time({service="telemetry"} |= "mqtt.broker.messages_dropped" [5m])) > 0`,
  severity critical.

- [ ] **Step 1: Write the failing tests** in `mqtt.broker.test.ts`, against a Mosquitto test container
  (`composeImage('mosquitto')`) configured with `max_queued_messages 5`:
  - `keeps its queue across a restart with a new process id` (scenario 12's broker half): connect with
    the configured client id, disconnect, publish 3 QoS 1 messages, reconnect from a new client instance
    → all 3 arrive.
  - `logs how many messages the broker dropped while it was away` (scenario 14): disconnect, publish
    20, reconnect → one `mqtt.broker.messages_dropped` with `dropped` ≥ 15.
  - `defaults the client id and a 30-minute session`.
- [ ] **Step 2:** `pnpm --filter telemetry-service exec vitest run src/lib/mqtt.broker.test.ts` → FAIL.
- [ ] **Step 3: Implement** the config, the session settings, the subscription and the check; add the
  alert rule file.
- [ ] **Step 4:** Same command → PASS; telemetry unit suite → PASS. Start Grafana
  (`docker compose up -d grafana`) and confirm `GET /api/v1/provisioning/alert-rules` lists the rule.
- [ ] **Step 5: Commit** after approval: `fix: keep telemetry's mqtt session and alert on dropped messages`.

### Task 10: The broker bridges an outage end to end

**Files:**
- Modify: `infra/mosquitto/mosquitto.conf`
- Create: `e2e/src/outage.e2e.test.ts`

**Interfaces:**
- Consumes: `stopService`, `startService` (Task 2), `publishSamples` (`e2e/src/support/plc.ts`).
- Broker config: `max_queued_messages 0` and a provisional `max_queued_bytes 67108864` (64 MiB, below
  the current 128 MB container limit) until Task 11 measures the real value.

- [ ] **Step 1: Write the failing tests:**
  - `records a stop whose running signal waited at the broker while telemetry was down` (scenario 12):
    publish 0 at T0, stop telemetry, publish 1 at T0 + 90 s, start telemetry → performance lists
    `[T0, T0 + 90 s]` with D = 60 s.
  - `keeps every run-mode transition a plant publishes during an outage` (scenario 13): 200 messages/s
    with 20 transitions over a 20 s outage → all 20 in telemetry's history with their own times.
- [ ] **Step 2:** `pnpm test:e2e` → FAIL (the default 1000-message queue drops transitions).
- [ ] **Step 3: Implement** the two broker settings.
- [ ] **Step 4:** `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** after approval: `fix: let the broker hold telemetry's queue through an outage`.

### Task 11: Measure the capacity and size the broker

**Files:**
- Create: `e2e/src/capacity/broker-capacity.capacity.test.ts`, `e2e/vitest.capacity.config.ts`
- Modify: `e2e/package.json` (`test:capacity`), root `package.json` (`test:capacity`)
- Create: `docs/operations/mqtt-broker-capacity.md`
- Modify: `infra/mosquitto/mosquitto.conf`, `docker-compose.yml` (mosquitto limits)

**Interfaces:**
- `CAPACITY_RATE` (default 500), `CAPACITY_OUTAGE_MINUTES` (default 30) and `CAPACITY_PAYLOAD_BYTES`
  (default 150) set the load. The run prints one table row: rate, outage, queued messages, broker
  store bytes (`$SYS/broker/store/messages/bytes`), broker peak memory (`docker stats` of the broker
  container), persistence file size, time to save it, time for telemetry to work off the backlog, and
  transitions lost (must be 0).

- [ ] **Step 1:** Write the capacity test on the e2e harness. Its broker runs the repository config
  without the provisional `max_queued_bytes` from Task 10 and with no container memory limit, so it
  measures what the queue needs rather than the ceiling.
- [ ] **Step 2:** `pnpm test:capacity` with the defaults; keep the full output in the scratchpad.
- [ ] **Step 3:** Write `docs/operations/mqtt-broker-capacity.md`: the load model, the method, the
  measured row, the commands to repeat it, and the settings derived from it.
- [ ] **Step 4:** Set `max_queued_bytes` to the measured store bytes × 1.25; the mosquitto memory limit
  to the measured peak × 1.25, rounded up to 64 MB; the CPU limit so the backlog drains within the
  measured time; `autosave_interval` from the measured save time. Record each next to its measurement.
- [ ] **Step 5:** `pnpm test:e2e` → PASS with the final settings.
- [ ] **Step 6: Commit** after approval: `perf: size the broker from a measured 30-minute outage`.

### Task 12: Verify everything

- [ ] **Step 1:** `pnpm typecheck` → 23 tasks successful.
- [ ] **Step 2:** `pnpm test` → all packages and services pass.
- [ ] **Step 3:** `pnpm test:contract` → all pass.
- [ ] **Step 4:** `pnpm test:e2e` → all pass; no `"level":"error"` lines in the run's service logs.
- [ ] **Step 5:** `pnpm exec biome check` on every changed path → no new warnings.
- [ ] **Step 6:** Keep every run's full output and service logs in the scratchpad; report counts.
