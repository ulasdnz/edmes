# MQTT Broker Capacity

While telemetry is down, the Mosquitto broker is the only place a machine signal can wait. This page
records how much the broker needs to hold telemetry's queue through an outage, how that was measured,
and the broker settings derived from it. The numbers were measured on the machine described under
[Measurement environment](#measurement-environment), at the load described below. Where a figure is
computed from them, the text says how.

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

The measured row (`pnpm test:capacity`, defaults, 3 November 2026):

| Rate | Payload | Outage | Queued messages | Broker store | Broker peak memory | Persistence file | Save | Backlog worked off in | Transitions lost |
|---|---|---|---|---|---|---|---|---|---|
| 500 msg/s | 150 B | 29 min 42 s | 886,500 | 132,975,328 B (126.8 MiB) | 598.5 MiB (peak RSS 594.3 MiB) | 240.1 MiB | 0.88 s | 7 min 19 s | 0 of 174 (100 in the outage) |

- **Outage** is the time telemetry was disconnected from the broker: from the moment its process was
  stopped until its `mqtt.connected` log line after the restart.
- **Queued messages and broker store** are the broker's own `$SYS/broker/store/messages/count` (minus
  the 56 messages in the store before the outage) and `$SYS/broker/store/messages/bytes`, read
  29 min 33 s into the outage. The broker publishes them every 10 seconds; 890,500 messages were
  published while telemetry was disconnected.
- **Broker peak memory** is the highest `docker stats` value of the broker container, with the highest
  resident set size of the Mosquitto process (`VmHWM`) next to it.
- **Persistence file and save** are the size of `mosquitto.db` and the time from asking the broker to
  save (`SIGUSR1`) until the new file replaced the old one, with the full queue in memory.
- **Backlog worked off in** is the time from starting telemetry again until it had stored, for every
  counter of every machine, a sample published after the restart. The plant kept publishing
  500 messages/s throughout.
- **Transitions lost** compares every run-mode transition the plant published with telemetry's
  history, value and machine time. Telemetry stores a run-mode value only when it changes, so the
  counters show the rest: all 1,016,550 counter samples were in the history too. None of the
  1,129,500 messages the plant published was lost.

Further measurements of the same run:

| Measurement | Value |
|---|---|
| Broker memory per queued message | 692.6 B resident (Mosquitto's own heap counter: 569.9 B) for a 150-byte payload: about 540 bytes of overhead per message for the stored message, its topic and its place in the client's queue |
| Persistence file per queued message | about 284 B |
| Broker CPU, average (highest over 5 s) | before the outage 0.038 cores (0.059); during the outage 0.031 (0.255, during an autosave); during the drain 0.123 (0.735) |
| How the broker hands the backlog over | all at once: its store went from 886,556 messages to 56 within 31 s of telemetry's reconnect (`$SYS` readings every 10 s) |
| Telemetry's rate while working off the backlog | about 2,540 messages/s, 5 times the arrival rate |
| Telemetry during the drain | resident memory up to 2,007 MiB from its health endpoint; 0.82 to 1.08 cores and a peak working set of 2,129.8 MiB, sampled from the Windows process outside the test |
| `$SYS/broker/publish/messages/dropped` | 0 for the whole run, the drain included; telemetry logged no `mqtt.broker.messages_dropped` |
| Error lines in the service logs | none |

This is one 30-minute run. Four shorter runs on the same host (outages of 1 and 5 minutes) measured
the same broker heap per queued message, 567 to 570 B, and 614 to 702 B resident. Their drain times
varied more: a backlog of about 16,000 messages took between 7 and 25 seconds.

## Settings derived from the measurement

| Setting | Measured | Rule | Value |
|---|---|---|---|
| `max_queued_bytes` (`infra/mosquitto/mosquitto.conf`) | broker store 132,975,328 B | × 1.25 | `166219160` |
| `max_queued_messages` | | the count is not the limit, the bytes are | `0` |
| Memory limit (`docker-compose.yml`) | 598.5 MiB `docker stats`, 594.3 MiB peak RSS | the larger × 1.25 = 748.1 MiB, rounded up to a multiple of 64 MiB | `768M` |
| CPU limit (`docker-compose.yml`) | 0.735 cores, the highest 5-second use during the drain | × 1.25 = 0.92, rounded up to a quarter CPU | `1` |
| `autosave_interval` | a save of the full queue took 0.88 s | the shortest whole minute in which saving a full queue blocks the broker for less than 2% of the time (0.88 s in 60 s is 1.5%) | `60` |

- **The queue ceiling** holds 1,108,127 payloads of 150 bytes: 36.9 minutes at 500 messages/s, or a
  30-minute outage at up to 615 messages/s. Telemetry's session expires after 30 minutes (see
  [When an outage runs longer](#when-an-outage-runs-longer)), so the margin covers a higher rate or
  larger payloads, not a longer outage.
- **The memory limit** is sized from what the broker used, not from the ceiling, because
  `max_queued_bytes` counts payload bytes only and a queued message costs about 4.6 times its
  payload. With the queue at the ceiling, the measured 692.6 B per message comes to about 738 MiB,
  still under 768 MiB. The container's cgroup also counted the page cache of the persistence file,
  up to 1,092.5 MiB in all after two saves. The kernel reclaims that cache under a limit. `docker stats`
  leaves it out, and this run had no limit, so that reclaim was not exercised.
- **The CPU limit** stays above everything the broker used in the measurement, so the quota does not
  slow the drain: the broker hands the backlog over faster than telemetry stores it, and telemetry's
  storing rate set the 7 min 19 s.

## Crashes and autosave

The broker keeps its queue in memory and writes all of it to `mosquitto.db` every `autosave_interval`
and when it shuts down cleanly. A `SIGKILL`, an out-of-memory kill or a power cut loses what arrived
since the last save. At the design load that is up to 60 s × 500 messages/s = 30,000 messages, about
3.4% of a full 30-minute queue; with Mosquitto's default of 1800 seconds it could be the whole
outage. In the measured run the default autosave ran once. 1800 s after the broker started, about
29 minutes into the outage, the container's page cache grew by the size of the file, and the broker
used 0.255 cores over that 5-second sample.

A save blocks the broker while it writes, so publishers wait for their acknowledgements. That took
0.88 s for the full queue and is far shorter at the near-empty queue of normal operation. A clean
stop also saves, and 0.88 s fits well within Docker's default 10-second stop grace period.

## Measurement environment

| | |
|---|---|
| Host | Intel Core Ultra 7 155U (12 cores, 14 threads), 32 GB RAM, NVMe SSD, Windows 11 Pro 10.0.26200 |
| Docker | Docker Desktop 29.9.2 on WSL 2.6.2, kernel 6.6.87.2-microsoft-standard-WSL2; the Docker VM had 14 CPUs and 15.4 GiB |
| Broker | `eclipse-mosquitto:2.1.2-alpine@sha256:860aeb5d63ce509508f6dcfb2bc8a1c1dd2bc60555b562b45ce90e52d8dabb0f`, the repository's `mosquitto.conf` without authentication and without `max_queued_bytes`, no container limits |
| MongoDB, Redis | the images `docker-compose.yml` pins, in containers |
| Services | the built services as Node 26.13.0 processes on the Windows host, without CPU or memory limits, reaching the containers through Docker Desktop's port forwarding |

Docker Desktop on a laptop is not a factory server. On a Linux server:

- **Broker memory, store bytes and file size** come from Mosquitto's own data structures, and the
  server runs the same image with the same allocator. They are not expected to change, but they were
  not measured on Linux.
- **CPU time and save time** depend on the server's CPU and disk. The CPU limit and the autosave
  interval carry the margins stated above.
- **Network:** here every client crossed Docker Desktop's port forwarding. On a server the services
  and the broker share one Docker network, which shortens every round trip.
- **Telemetry ran without its compose limits.** `docker-compose.yml` gives it 0.5 CPU and 512M, and
  during this drain it used about one core and up to 2 GB. See the next section.

## Telemetry and performance during the catch-up

**Telemetry's memory.** Telemetry acknowledges each MQTT message as it arrives and stores it
afterwards. When it reconnects, the broker therefore hands it the whole backlog within seconds, and
telemetry holds it in memory until it has stored it. In this run that took up to 2,007 MiB, four
times telemetry's 512M compose limit. This run did not apply that limit. Holding four times its
limit here, telemetry is expected to be killed during the catch-up under it, and to lose the
messages it had already acknowledged. The broker settings on this page do not change that. Until
telemetry bounds what it holds, the target is measured as met on this host, not within the compose
limits.

**Telemetry's event stream.** Telemetry publishes every stored sample to `events.telemetry` as
`tag.value.recorded`, and the stream is trimmed at about 10,000 entries. From telemetry's restart to
the end of the run it published 1,002,724 entries. Performance stayed about 10,000 entries behind for
the whole drain, using 0.15 cores, and 705,561 entries (70%) were trimmed before it read them. The
count is the entries added minus the entries performance acknowledged: Redis counts every `XACK` in
`INFO commandstats`, and each delivered entry is acknowledged once.

The consumers of `tag.value.recorded` are affected differently:

- **Performance's run-mode rules rely on the replay.** When a run-mode sample arrives whose
  predecessor in telemetry's history is newer than the last sample performance processed, rule 6
  replays the gap from telemetry's history first (`run_mode.sample.gap_replayed`). A tag whose last
  sample was trimmed is decided only when its next sample arrives. In this run, rule 6 logged no
  `run_mode.sample.gap_replayed` line. All 100 transitions published during the outage were decided,
  but 18 transitions published during the drain were still undecided at the end of the run: their
  entries were trimmed, and their machines had not changed state again.
- **The realtime gateway** forwards the events to screens and has no replay. A trimmed entry is a live
  update a screen never shows; the next value replaces it. The e2e harness does not run realtime, so
  this run did not measure it.

**The dropped counter.** Telemetry subscribes to `$SYS/broker/publish/messages/dropped` at QoS 0. When
an online client's queue sits at the byte ceiling, Mosquitto drops QoS 0 messages to it and counts
them. In this run the broker had no ceiling and the counter stayed at 0 throughout the drain, so the
`$SYS` updates added nothing to it. Under the derived ceiling, a queue at the design load stays below
it and shrinks from the moment telemetry reconnects, so the updates are not dropped there either.
That follows from Mosquitto's rule; no run was made with the ceiling in place.

## When an outage runs longer

Telemetry's session expires 1800 seconds after it disconnects (`MQTT_SESSION_EXPIRY_SECONDS`), the
same 30 minutes as the target. The broker then discards the queue. In a test with a 5-second session
and the same image, the broker logged `Expiring client aimes-telemetry due to timeout.` and deleted
the 20 queued messages. `$SYS/broker/publish/messages/dropped` stayed at 0, and telemetry reconnected
with `sessionPresent=false` and received nothing. At the design load the ceiling holds 36.9 minutes,
so an outage longer than 30 minutes ends with the session expiring, not with the ceiling dropping
messages. Telemetry's `mqtt.broker.messages_dropped` alert does not fire for that.

The same session expiry is why the measured outage is 29 min 42 s rather than 30 minutes. The
measurement reads the full queue, saves it and starts telemetry again 30 seconds before the outage
reaches its length, so telemetry reconnects while its session still exists.

## Repeating the measurement

Docker must be running. The run builds the services, starts the e2e harness (MongoDB, Redis and the
broker in containers, the services as processes), and takes about 40 minutes with the defaults:

```bash
pnpm test:capacity --reporter=verbose
```

`CAPACITY_RATE` (default 500, a multiple of 10: one machine per 10 tags), `CAPACITY_OUTAGE_MINUTES`
(default 30) and `CAPACITY_PAYLOAD_BYTES` (default 150) set the load:

```bash
CAPACITY_RATE=1000 CAPACITY_PAYLOAD_BYTES=200 pnpm test:capacity --reporter=verbose
```

In PowerShell, set them first: `$env:CAPACITY_RATE = '1000'`. An outage longer than telemetry's
session needs a longer session, which the harness passes on to telemetry:
`MQTT_SESSION_EXPIRY_SECONDS=3600 CAPACITY_OUTAGE_MINUTES=45`.

The run prints the row above and writes every sample (broker memory and CPU every 5 seconds, each
`$SYS` value, telemetry's memory, performance's place in the event stream) to `capacity.json` in the
run's folder under `e2e/logs/`. It fails if a message was lost or the broker counted a dropped
message. The broker in this run has no queue ceiling, so it measures what the queue needs, not
whether the ceiling holds. To size another site, take the new row and apply the rules in
[Settings derived from the measurement](#settings-derived-from-the-measurement).
