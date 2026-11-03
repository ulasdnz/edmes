# MQTT Broker Capacity

While telemetry is down, the Mosquitto broker is the only place a machine signal can wait. This page
records how much the broker needs to hold telemetry's queue through an outage, how telemetry works
off the backlog once it is back, how that was measured, and the settings derived from it. The numbers
were measured on the machine described under [Measurement environment](#measurement-environment), at
the load described below. Where a figure is computed from them, the text says how.

## Target and load model

**Target:** a telemetry outage of up to 30 minutes at the design load loses no MQTT message.

There is no field data yet, so the design load is an explicit assumption. A customer's own rate
replaces it by repeating the measurement (see [Repeating the measurement](#repeating-the-measurement)).

| Parameter | Design value | What the measurement publishes |
|---|---|---|
| Message rate | 500 messages/s | 50 machines × 10 tags × 1 Hz, one MQTT connection per machine, QoS 1 |
| Message size | about 150 bytes including the topic | a 150-byte payload; the topic (`devices/capacity-m001/nodes/counter-1`, 31 to 37 bytes) comes on top |
| Run-mode transitions | a few per machine per hour | every machine stops for 3 minutes in every 30, each at its own time: 4 transitions per machine per hour |
| Outage | 30 minutes | telemetry is stopped and started again while the plant keeps publishing |

The payload is padded to exactly 150 bytes, so the measured queue is slightly larger than the load
model's: the broker's queue limit counts payload bytes only.

## Result

The measured row (`pnpm test:capacity`, defaults, 3 November 2026). The broker ran the repository's
`mosquitto.conf` with its queue ceiling, under its `docker-compose.yml` limits. Telemetry and
performance ran as containers built from their Dockerfiles, under their compose limits of 0.5 CPU
and 512M each.

| Rate | Payload | Outage | Queued messages | Broker store | Broker peak memory | Persistence file | Save | Telemetry caught up in | Transitions lost |
|---|---|---|---|---|---|---|---|---|---|
| 500 msg/s | 150 B | 30 min 11 s | 901,839 | 135,276,178 B (129.0 MiB) | 610.1 MiB (peak RSS 605.1 MiB) | 244.1 MiB | 1.06 s | 14 min 1 s | 0 of 198 (102 in the outage) |

- **Outage** is the time telemetry was disconnected from the broker: from its stop until its
  `mqtt.connected` log line after the restart.
- **Queued messages and broker store** are the broker's own `$SYS/broker/store/messages/count` (minus
  the messages in the store before the outage) and `$SYS/broker/store/messages/bytes`, read
  30 min 3 s into the outage. The broker publishes them every 10 seconds; 905,000 messages were
  published while telemetry was disconnected.
- **Broker peak memory** is the highest `docker stats` value of the broker container, with the highest
  resident set size of the Mosquitto process (`VmHWM`) next to it.
- **Persistence file and save** are the size of `mosquitto.db` and the time from asking the broker to
  save (`SIGUSR1`) until the new file replaced the old one, with the full queue in memory.
- **Telemetry caught up in** is the time from starting telemetry again until every counter of every
  machine had a sample from the last 5 seconds: everything published until then was stored. The
  plant kept publishing 500 messages/s throughout.
- **Transitions lost** compares every run-mode transition the plant published with telemetry's
  history, value and machine time. Telemetry stores a run-mode value only when it changes, so the
  counters show the rest: all 1,210,500 counter samples were in the history too. None of the
  1,345,000 messages the plant published was lost.

Further measurements of the same run:

| Measurement | Value |
|---|---|
| Broker memory per queued message | 691.5 B resident (Mosquitto's own heap counter: 569.7 B) for a 150-byte payload: about 540 bytes of overhead per message for the stored message, its topic and its place in the client's queue |
| Persistence file per queued message | about 284 B |
| Broker CPU, average (highest over 5 s) | before the outage 0.048 cores (0.059); during the outage 0.027 (0.138); while telemetry caught up 0.101 (0.361) |
| How the broker hands the backlog over | at telemetry's pace: its store fell by about 1,050 messages a second, and was empty 846 s after telemetry's restart |
| Telemetry while it caught up | it stored the 905,000 messages published while it was disconnected within 9 min 30 s of its restart, and caught up 13 min 57 s after its reconnect: 1,574 messages/s, three times the arrival rate. It used its whole 0.5 CPU, and at most 87.0 MiB of its 512 MiB (cgroup 92.7 MiB; its health endpoint reported 144 MiB resident). |
| Telemetry before the outage | 0.24 cores at 500 messages/s, 87.8 MiB |
| Performance | 0.14 cores while telemetry caught up (0.08 before), at most 64.5 MiB; at most 3,483 entries behind telemetry's event stream |
| `$SYS/broker/publish/messages/dropped` | 0 for the whole run, the catch-up included; telemetry logged no `mqtt.broker.messages_dropped` and no `mqtt.session.lost` |
| Error lines in the service logs | none |

This is one 30-minute run. Nine shorter runs with the same setup (outages of 1 and 2 minutes, at
intake bounds from 5 to 1000) measured a broker heap per queued message of 567.7 to 568.3 B (569.7 B
here), and 664.6 to 690.7 B resident (691.5 B here). The two short runs that timed the catch-up
stored 1,328 and 1,588 messages/s.

## Settings derived from the measurement

Each setting comes from this run. Where the run itself ran with an earlier value, the last column
gives it.

| Setting | Measured | Rule | Value | The run used |
|---|---|---|---|---|
| `max_queued_bytes` (`infra/mosquitto/mosquitto.conf`) | broker store 135,276,178 B | × 1.25 | `169095223` | `166219160`; the queue reached neither that nor `169095223`, and stayed 19% under the value the run used |
| `max_queued_messages` | | the count is not the limit, the bytes are | `0` | `0` |
| Broker memory limit (`docker-compose.yml`) | 691.5 B resident per queued message; the ceiling holds 1,127,301 payloads of 150 bytes | computed, not run: 691.5 B × 1,127,301 × 1.25 = 929.3 MiB, rounded up to a multiple of 64 MiB | `960M` | `960M`, with the queue at 80% of the ceiling |
| Broker CPU limit (`docker-compose.yml`) | 0.361 cores, the highest 5-second use while telemetry caught up, under a limit of 1 CPU | the value the run measured under; × 1.25 would give 0.5, which no run used | `1` | `1` |
| `autosave_interval` | a save of the full queue took 1.06 s | the shortest whole minute in which saving a full queue blocks the broker for less than 2% of the time (1.06 s in 60 s is 1.8%) | `60` | `60` |
| Telemetry and performance limits (`docker-compose.yml`) | telemetry used its whole 0.5 CPU and at most 87.0 MiB, and caught up at three times the arrival rate; performance used at most 0.29 cores over 5 s and 64.5 MiB | kept: within them telemetry stores faster than the plant publishes, and no service came near its memory limit | 0.5 CPU and `512M` each | the same |

- **The queue ceiling** holds 1,127,301 payloads of 150 bytes: 37.6 minutes at 500 messages/s, or a
  30-minute outage at up to 626 messages/s. Telemetry's session lasts a day, so an outage longer
  than the ceiling allows fills the queue to the ceiling, and the broker drops and counts what comes
  after (see [When an outage runs longer](#when-an-outage-runs-longer)).
- **The memory limit** is computed for a queue at the ceiling, which a longer outage now reaches, from
  what a queued message measurably costs, not from the ceiling's bytes: `max_queued_bytes` counts
  payload bytes only, and a queued message costs about 4.6 times its payload. No run held a queue at
  the ceiling under this limit. By the measured cost the broker's resident size there would come to
  about 750 MiB. The container's cgroup also counts the persistence file's page cache, and in this
  run, with the queue at 80% of the ceiling, the cgroup already reached 960.0 MiB: 605 MiB resident,
  the rest page cache the saves left. That cache is reclaimable: the kernel reclaimed it at the limit,
  and the broker ran on. `docker stats` leaves the cache out.
- **The CPU limit** is the value the run measured under, 1 CPU. A CPU limit is a cap, not a
  reservation, and a use measured under a cap cannot show demand above it, so the limit stays at the
  value the measurement had: the × 1.25 rule would give 0.5, which no run used. With telemetry's intake
  bounded, the broker hands the queue over at telemetry's pace rather than all at once: its highest use
  was 0.361 cores, where the comparison run's burst took 0.735.

## Telemetry's intake

Telemetry acknowledges a message as it arrives and stores it afterwards. Before it had a bound, the
broker handed a reconnecting telemetry its whole queue within about 30 seconds, and telemetry held
it in memory: 2,007 MiB after a 30-minute outage, four times its container limit (see
[Comparison](#comparison-telemetry-without-its-limits)). `MQTT_MAX_UNSTORED_MESSAGES` now bounds the
messages telemetry has received and not stored. At the bound it holds back the next
acknowledgement; MQTT.js then stops reading, and the broker keeps the rest of the queue.

**The default, 20, was measured.** Telemetry, under its compose limits, worked off a backlog of about
65,000 messages after a 2-minute outage, once for each bound. The rate is the backlog over the time
from its reconnect until every counter had a sample from after the restart:

| `MQTT_MAX_UNSTORED_MESSAGES` | 5 | 10 | 20 | 100 | 1000 |
|---|---|---|---|---|---|
| Stored messages/s | 854 | 978 | 1,172 and 1,141 (two runs) | 1,152 | 572 |

20 is the smallest bound at which telemetry stored fastest. Telemetry used its whole 0.5 CPU in
every run, and many concurrent stores cost CPU of their own, so a bound of 1000 stored at half the
speed. Telemetry's memory stayed between 80 and 102 MiB at every bound.

- **A crash** loses at most the messages telemetry acknowledged and had not stored: fewer than
  `MQTT_MAX_UNSTORED_MESSAGES`. The message it holds back is not acknowledged, and the broker
  delivers it again.
- **A clean stop** takes nothing more in and acknowledges nothing more, lets the stores in progress
  finish, and then closes MongoDB and Redis. The broker delivers again what was still arriving.
- **MongoDB unreachable.** A store or tag lookup that fails because MongoDB cannot be reached (the
  driver's server-selection or network error, or Mongoose's buffering timeout) keeps its place and
  tries again after 1 s, then twice as long each time, at most 30 s apart, for as long as the error
  lasts. The messages after it for the same node wait behind it, the intake holds at its bound, and the
  broker keeps the rest of the queue. Telemetry logs one `ingestion.store.deferred` warning when a
  message first waits, and one `ingestion.store.resolved` line with `waitedMs` once it is handled. A
  test stopped a standalone MongoDB while a machine published, and started it again: every message was
  stored once and in the order published, and the broker held what telemetry had not taken in. Any
  other store error, MongoDB rejecting the document for example, drops that message with
  `ingestion.error`, and the messages after it are stored.
- **A stop while MongoDB is unreachable** ends the waits at once, so it does not hold the stop:
  telemetry logs one `ingestion.store.abandoned` error for each message it gives up, and closes. Like a
  crash, it loses at most the messages it acknowledged and had not stored, fewer than
  `MQTT_MAX_UNSTORED_MESSAGES`; one of the abandoned messages can be the one held back, which the
  broker delivers again.
- **A store that waits longer than the keepalive**, for a MongoDB that is down or a dependency that
  does not answer, holds the intake past it. MQTT.js counts its keepalive from acknowledgements and ping
  answers it has read, and while the intake is held it reads neither. With telemetry's default
  keepalive of 60 s, a test with stores hanging for 150 s showed:
  - after 90 s, MQTT.js reported a keepalive timeout and reconnected 10 s later, with the session;
  - the broker delivered again the one message telemetry had held back unacknowledged, and once the
    stores finished, every message had arrived;
  - telemetry logged `mqtt.error` and `mqtt.offline` for the timeout.

  So while the wait lasts, telemetry reconnects, with an error line, about every 100 s.
- **At startup**, telemetry stops when its subscriptions fail. A wait that holds the intake while
  telemetry starts into a backlog lets the keepalive timeout fail them (the test above began its hang
  before the subscriptions were confirmed). Telemetry exits, Docker starts it again
  (`restart: unless-stopped`), and the exit repeats about every 100 s while the wait lasts. Each exit
  is a crash: it loses at most the messages telemetry acknowledged and had not stored, fewer than
  `MQTT_MAX_UNSTORED_MESSAGES`. If MongoDB is unreachable when telemetry starts, telemetry exits before
  it connects to the broker, so it takes nothing in, and Docker starts it again.
- **Starting with a backlog**, the broker sends up to 2500 queued messages (telemetry's MQTT 5 Receive
  Maximum) ahead of the confirmation of telemetry's subscriptions, and telemetry reads the
  confirmation only after storing its way to it. Telemetry's memory stayed flat in every run, so the
  messages in flight do not cost it memory, and the Receive Maximum stays at 2500.

## Crashes and autosave

The broker keeps its queue in memory and writes all of it to `mosquitto.db` every `autosave_interval`
and when it shuts down cleanly. A `SIGKILL`, an out-of-memory kill or a power cut loses what arrived
since the last save, and nothing counts it: the broker restarts from its last save, and
`$SYS/broker/publish/messages/dropped` starts from 0. At the design load that is up to
60 s × 500 messages/s = 30,000 messages, about 3.3% of the 30-minute queue. With Mosquitto's default
of 1800 seconds it could be the whole outage.

A save blocks the broker while it writes, so publishers wait for their acknowledgements. That took
1.06 s for the full queue, and far less at the near-empty queue of normal operation. A clean stop
also saves, within Docker's default 10-second stop grace period.

## When an outage runs longer

Telemetry's session lasts a day (`MQTT_SESSION_EXPIRY_SECONDS`, default 86400): far longer than the
37.6 minutes the queue ceiling takes to fill at the design load. An outage longer than
the ceiling allows therefore ends with the broker dropping new messages. The broker counts them in
`$SYS/broker/publish/messages/dropped`, telemetry logs `mqtt.broker.messages_dropped` when it is
back, and a Grafana rule alerts on it.

A session that expires takes its whole queue with it, and the broker counts none of it as dropped. In
a test with a 5-second session, the broker logged `Expiring client aimes-telemetry due to timeout.`
and deleted the 20 queued messages. The dropped counter stayed at 0, and telemetry reconnected with
`sessionPresent=false` and received nothing.

- Telemetry therefore keeps a marker in Redis once it has had a session. When it connects without a
  session while the marker says it had one, it logs `mqtt.session.lost`, and a second Grafana rule
  alerts on that.
- The same marker catches a broker that restarted without its persistence file, and a changed
  `MQTT_CLIENT_ID`.
- A day still bounds how long an orphaned session lives, and how long the broker keeps writing a full
  queue at every autosave.

## Telemetry and performance during the catch-up

**Telemetry's event stream.** Telemetry publishes every stored sample to `events.telemetry` as
`tag.value.recorded`, and the stream is trimmed at about 10,000 entries. From telemetry's restart to
the end of the run it published 1,197,003 entries, and performance read every one of them: none was
trimmed before it read it. Performance stayed at most 3,483 entries behind. The count is the entries
added minus the entries performance acknowledged: Redis counts every `XACK` in `INFO commandstats`,
and each delivered entry is acknowledged once. In the comparison run, 70% were trimmed. There the
unbounded telemetry published faster, and performance read through Docker Desktop's port
forwarding.

The consumers of `tag.value.recorded` depend on the entries differently:

- **Performance's run-mode rules rely on the replay.** When a run-mode sample arrives whose
  predecessor in telemetry's history is newer than the last sample performance processed, rule 6
  replays the gap from telemetry's history first (`run_mode.sample.gap_replayed`). A tag whose last
  sample was trimmed is decided only when its next sample arrives. In this run nothing was trimmed:
  rule 6 logged no `run_mode.sample.gap_replayed` line, and all 198 run-mode transitions were decided
  by the end of the run.
- **The realtime gateway** forwards the events to screens and has no replay. A trimmed entry is a live
  update a screen never shows; the next value replaces it. The harness does not run realtime, so this
  run did not measure it.

**The dropped counter.** Telemetry subscribes to `$SYS/broker/publish/messages/dropped` at QoS 0. When
an online client's queue sits at the byte ceiling, Mosquitto drops QoS 0 messages to it and counts
them. In this run the queue stayed 19% under the ceiling and the counter stayed at 0 throughout the
catch-up, so the `$SYS` updates added nothing to it. By the same rule, which this run did not test,
they would be dropped and counted only while the queue sits at the ceiling. That happens after an
outage that has already dropped messages, which telemetry reports anyway.

## Measurement environment

| | |
|---|---|
| Host | Intel Core Ultra 7 155U (12 cores, 14 threads), 32 GB RAM, NVMe SSD, Windows 11 Pro 10.0.26200 |
| Docker | Docker Desktop 29.9.2 on WSL 2.6.2, kernel 6.6.87.2-microsoft-standard-WSL2; the Docker VM had 14 CPUs and 15.4 GiB |
| Broker | `eclipse-mosquitto:2.1.2-alpine@sha256:860aeb5d63ce509508f6dcfb2bc8a1c1dd2bc60555b562b45ce90e52d8dabb0f`, the repository's `mosquitto.conf` without authentication, with the ceiling of `166219160` bytes, under 1 CPU and 960 MiB |
| Telemetry, performance | containers built from their Dockerfiles (Node 26.13.0), 0.5 CPU and 512 MiB each, on one Docker network with MongoDB, Redis and the broker |
| MongoDB, Redis | the images `docker-compose.yml` pins, in containers, without limits |
| User, work-center, production | the built services as Node processes on the Windows host |
| The plant | 50 MQTT connections from the Windows host, through Docker Desktop's port forwarding |

Docker Desktop on a laptop is not a factory server. On a Linux server:

- **Broker memory, store bytes and file size** come from Mosquitto's own data structures, and the
  server runs the same image with the same allocator. They are not expected to change, but they were
  not measured on Linux.
- **CPU time and save time** depend on the server's CPU and disk. Telemetry's catch-up is bound by its
  0.5 CPU, so a faster or slower server CPU changes the catch-up time in proportion. The broker's CPU
  limit is 2.8 times its highest use, and the autosave interval carries the margin stated above.
- **Network:** the services and the broker shared one Docker network, as on a server; only the plant
  crossed Docker Desktop's port forwarding.

## Comparison: telemetry without its limits

The first measurement ran telemetry and performance as unlimited processes on the Windows host,
reaching the containers through Docker Desktop's port forwarding, and the broker without its queue
ceiling or limits. Telemetry had no intake bound then.

| Rate | Payload | Outage | Queued messages | Broker store | Broker peak memory | Persistence file | Save | Outage backlog stored in | Transitions lost |
|---|---|---|---|---|---|---|---|---|---|
| 500 msg/s | 150 B | 29 min 42 s | 886,500 | 132,975,328 B (126.8 MiB) | 598.5 MiB (peak RSS 594.3 MiB) | 240.1 MiB | 0.88 s | 7 min 19 s | 0 of 174 (100 in the outage) |

- **The handover.** The broker handed the whole queue to telemetry within 31 seconds of its reconnect.
- **Telemetry's resources.** It held up to 2,007 MiB and used up to 1.08 cores while it stored about
  2,040 messages/s: the 890,500 messages published while it was disconnected, in 7 min 16 s from its
  reconnect.
- **Performance** read telemetry's event stream through the port forwarding, one acknowledgement per
  entry. It stayed about 10,000 entries behind, and 705,561 of 1,002,724 entries (70%) were trimmed
  before it read them.

That run did not time telemetry catching up with the plant.

## Repeating the measurement

Docker must be running. The run builds the services and the telemetry and performance images,
starts the harness, and takes about 50 minutes with the defaults:

```bash
pnpm test:capacity --reporter=verbose
```

`CAPACITY_RATE` (default 500, a multiple of 10: one machine per 10 tags), `CAPACITY_OUTAGE_MINUTES`
(default 30) and `CAPACITY_PAYLOAD_BYTES` (default 150) set the load. `MQTT_*` variables reach
telemetry, for example `MQTT_MAX_UNSTORED_MESSAGES`:

```bash
CAPACITY_RATE=1000 CAPACITY_PAYLOAD_BYTES=200 pnpm test:capacity --reporter=verbose
```

In PowerShell, set them first: `$env:CAPACITY_RATE = '1000'`.

The default run measures the deployment: the broker with its queue ceiling and limits.
`CAPACITY_BROKER=uncapped` runs the broker without them, to measure what a queue at another rate
needs; take that row and apply the rules in
[Settings derived from the measurement](#settings-derived-from-the-measurement).

The run prints the row above and writes every sample to `capacity.json` in the run's folder under
`e2e/logs/`: broker, telemetry and performance memory and CPU every 5 seconds, each `$SYS` value, and
performance's place in the event stream. It fails if a message was lost, if the broker counted a
dropped message, if telemetry lost its session, or if a service logged an error.
