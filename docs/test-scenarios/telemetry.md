# Test Scenarios: telemetry

> Generated: 2026-04-03 | Spec: docs/superpowers/specs/2026-04-01-telemetry-service-design.md | Plan: docs/superpowers/plans/2026-04-02-telemetry-service.md
> Status: READY
> Immutable after implementation starts.
>    To change: update this file, then re-run /write-scenario-tests.

---

## TagType.create
> target: telemetry/src/modules/tag-type/__tests__/tag-type.service.test.ts
> plan-task: 3

### happy path
- valid data (name, unit, displayColor, manualEntryMode) → returns doc with timestamps, audit fields
- only required field (name) → returns doc with defaults: unit=null, displayColor=null, manualEntryMode='none'

### constraints
- name already exists → error (duplicate)
- name missing → validation error
- manualEntryMode not in ['none', 'number', 'boolean'] → validation error

### authorization
- [CRITICAL] caller without `createTagTypes` permission → 403

---

## TagType.list
> target: telemetry/src/modules/tag-type/__tests__/tag-type.service.test.ts
> plan-task: 3

### happy path
- multiple tag types exist → returns paginated list with { data, pagination }

### authorization
- [CRITICAL] caller without `readTagTypes` permission → 403

---

## TagType.getById
> target: telemetry/src/modules/tag-type/__tests__/tag-type.service.test.ts
> plan-task: 3

### happy path
- valid id → returns tag type doc

### constraints
- non-existent id → error.not_found

### authorization
- [CRITICAL] caller without `readTagTypes` permission → 403

---

## TagType.update
> target: telemetry/src/modules/tag-type/__tests__/tag-type.service.test.ts
> plan-task: 3

### happy path
- valid partial update (e.g. unit only) → returns updated doc, updatedAt changed

### constraints
- name already taken by another tag type → error (duplicate)
- non-existent id → error.not_found

### authorization
- [CRITICAL] caller without `writeTagTypes` permission → 403

---

## TagType.delete
> target: telemetry/src/modules/tag-type/__tests__/tag-type.service.test.ts
> plan-task: 3

### happy path
- valid id, no tags referencing → deleted successfully

### constraints
- non-existent id → error.not_found

### authorization
- [CRITICAL] caller without `deleteTagTypes` permission → 403

---

## EdgeDevice.create
> target: telemetry/src/modules/edge-device/__tests__/edge-device.service.test.ts
> plan-task: 4

### happy path
- valid data (name, deviceKey, ipAddress) → returns doc with status='unknown', timestamps, audit fields

### constraints
- name already exists → error (duplicate)
- deviceKey already exists → error (duplicate)
- deviceKey format invalid (not matching `^[a-z0-9][a-z0-9-]*[a-z0-9]$`) → validation error
- name missing → validation error
- deviceKey missing → validation error
- ipAddress missing → validation error

### boundaries
- deviceKey single char (e.g. 'a') → validation error (regex requires min 2 chars with start+end pattern)
- deviceKey with uppercase letters → validation error
- deviceKey with leading/trailing hyphen → validation error
- deviceKey 'a1' (2 chars, valid) → allowed

### authorization
- [CRITICAL] caller without `createEdgeDevices` permission → 403

---

## EdgeDevice.list
> target: telemetry/src/modules/edge-device/__tests__/edge-device.service.test.ts
> plan-task: 4

### happy path
- multiple devices exist → returns paginated list

### authorization
- [CRITICAL] caller without `readEdgeDevices` permission → 403

---

## EdgeDevice.getById
> target: telemetry/src/modules/edge-device/__tests__/edge-device.service.test.ts
> plan-task: 4

### happy path
- valid id → returns edge device doc

### constraints
- non-existent id → error.not_found

### authorization
- [CRITICAL] caller without `readEdgeDevices` permission → 403

---

## EdgeDevice.update
> target: telemetry/src/modules/edge-device/__tests__/edge-device.service.test.ts
> plan-task: 4

### happy path
- valid partial update (e.g. ipAddress only) → returns updated doc

### constraints
- name already taken by another device → error (duplicate)
- non-existent id → error.not_found
- [CRITICAL] attempt to change deviceKey → rejected (immutable field)

### authorization
- [CRITICAL] caller without `writeEdgeDevices` permission → 403

---

## EdgeDevice.delete
> target: telemetry/src/modules/edge-device/__tests__/edge-device.service.test.ts
> plan-task: 4

### happy path
- valid id, no tags bound to this device → deleted successfully

### constraints
- non-existent id → error.not_found

### authorization
- [CRITICAL] caller without `deleteEdgeDevices` permission → 403

---

## Tag.create
> target: telemetry/src/modules/tag/__tests__/tag.service.test.ts
> plan-task: 5

### happy path
- valid counter tag with binding → returns doc with all fields, timestamps, audit fields
- valid binary tag without binding (virtual tag) → returns doc with binding=null
- valid speed tag → returns doc
- digit/tolerance/min/max provided for counter → accepted
- digit/tolerance/min/max omitted for binary → defaults applied

### constraints
- tagTypeId not in DB → error.not_found
- behavior not in ['counter', 'speed', 'binary'] → validation error
- binding.deviceKey provided but deviceKey not matching any EdgeDevice → validation error or allowed (spec says binding references deviceKey string, not necessarily validated against EdgeDevice)
- [CRITICAL] binding with nodeId already bound to another tag → error (binding uniqueness violated)
- binding without nodeId → uniqueness check skipped
- digit/tolerance/min/max provided for binary behavior → validation error (only for counter/speed)

### boundaries
- tolerance=0 (default) → no tolerance filtering applied during ingestion
- digit=0 → rounds to integer
- binding with nodeId=null vs binding=null → both valid, different semantics (bound device without specific node vs unbound)

### authorization
- [CRITICAL] caller without `createTags` permission → 403

---

## Tag.list
> target: telemetry/src/modules/tag/__tests__/tag.service.test.ts
> plan-task: 5

### happy path
- multiple tags exist → returns paginated list

### authorization
- [CRITICAL] caller without `readTags` permission → 403

---

## Tag.getById
> target: telemetry/src/modules/tag/__tests__/tag.service.test.ts
> plan-task: 5

### happy path
- valid id → returns tag doc with binding info

### constraints
- non-existent id → error.not_found

### authorization
- [CRITICAL] caller without `readTags` permission → 403

---

## Tag.update
> target: telemetry/src/modules/tag/__tests__/tag.service.test.ts
> plan-task: 5

### happy path
- valid partial update (e.g. name, desc) → returns updated doc
- change binding from one node to another → binding cache updated synchronously
- remove binding (set to null) → binding cache entry removed

### constraints
- non-existent id → error.not_found
- [CRITICAL] behavior change attempt → rejected (behavior immutable after creation)
- [CRITICAL] new binding with nodeId already bound to another tag → error (binding uniqueness)

### authorization
- [CRITICAL] caller without `writeTags` permission → 403

---

## Tag.delete
> target: telemetry/src/modules/tag/__tests__/tag.service.test.ts
> plan-task: 5

### happy path
- tag with no historian collection → deleted
- tag with empty historian collection → deleted, collection left as-is
- tag with non-empty historian, forceDelete=true → deleted, historian collection dropped

### constraints
- non-existent id → error.not_found
- [CRITICAL] tag with non-empty historian, no forceDelete → 409 Conflict

### edge cases
- [HIGH] delete tag with binding → binding cache and predecessor cache entries cleaned up

### authorization
- [CRITICAL] caller without `deleteTags` permission → 403

---

## BindingCache
> target: telemetry/src/modules/ingestion/__tests__/binding-cache.test.ts
> plan-task: 7

### happy path
- set tag with binding (deviceKey + nodeId) → retrievable via bindingCacheGet(deviceKey, nodeId)
- delete binding → lookup returns undefined
- init from DB → all bound tags loaded into cache

### constraints
- tag without nodeId in binding → not cached (MQTT routing needs both deviceKey and nodeId)
- lookup for non-existent key → returns undefined

---

## PredecessorCache
> target: telemetry/src/modules/ingestion/__tests__/predecessor-cache.test.ts
> plan-task: 7

### happy path
- set entry → retrievable via predecessorGet
- delete entry → returns undefined
- lazy load from DB → fetches last sample from tag's historian collection, populates cache
- counter tag lazy load → includes prev2Value and prev2Ts
- speed/binary tag lazy load → no prev2 fields

### constraints
- lazy load for tag with no historian collection → returns undefined
- lazy load for tag with empty historian collection → returns undefined

---

## Ingestion.processMessage (MQTT path)
> target: telemetry/src/modules/ingestion/__tests__/ingestion.pipeline.test.ts
> plan-task: 8

### happy path
- valid MQTT message for bound counter tag → sample persisted to tag_samples_{tagId} with predecessor fields
- valid MQTT message for bound speed tag → sample persisted with prevValue, prevTs
- valid MQTT message for bound binary tag, state change (0→1) → sample persisted
- first sample for a tag (no predecessor) → prevValue=null, prevTs=null; counter: prev2Value=null, prev2Ts=null, reset=false
- after persist → `tag.value.recorded` event emitted on `events.telemetry` with `{ tagId, behavior, value, occurredAt }`

### constraints
- topic not matching `devices/{deviceKey}/nodes/{nodeId}` format → silently dropped
- no binding found for deviceKey:nodeId → silently dropped (no log)
- malformed JSON payload → silently dropped
- invalid time (non-parseable date) → silently dropped

### edge cases
- [HIGH] out-of-order message (time <= last occurredAt) → dropped
- [HIGH] duplicate value (same value as predecessor, newer time) → dropped (dedup)
- [HIGH] tolerance below threshold (counter/speed, |value - prevValue| < tolerance) → dropped
- [HIGH] binary same state (value === prevValue) → dropped
- [HIGH] period closure lock active, sample time <= lock → rejected (MQTT handler catches, logs debug)

---

## Ingestion.ingestValue (shared pipeline)
> target: telemetry/src/modules/ingestion/__tests__/ingestion.pipeline.test.ts
> plan-task: 8

### happy path
- digit rounding applied before comparison: rawValue=3.456, digit=2 → value becomes 3.46
- counter first sample → reset=false
- counter second sample → predecessor correctly set from first sample
- counter third sample → prev2 values populated from chain

### constraints
- digit rounding only for counter/speed, not binary

### edge cases
- [HIGH] counter reset detection: values 100, 101, 50, 51 → peak detected at 101, reset=true on the sample where peak is confirmed
- [HIGH] counter glitch detection: values 100, 101, 50, 102 → peak=false (50 was glitch, 102 continues normal)
- [HIGH] counter reset formula: `(prev2 > curr && curr > prev1) OR (prev2 > prev1 && prev1 > curr)` → reset=true

---

## Tag.writeValue (REST path)
> target: telemetry/src/modules/tag/__tests__/tag-value.test.ts
> plan-task: 9

### happy path
- POST /tags/:id/values with valid { time, value } → 201, sample persisted through same ingestion pipeline
- same ingestion rules apply: dedup, rounding, tolerance, out-of-order rejection

### constraints
- tag not found → 404
- time not valid datetime string → validation error
- value not a number → validation error

### edge cases
- [HIGH] time <= last recorded sample time → ingestion drops silently (REST returns 201 but no sample written — or should it return error?)

### authorization
- [CRITICAL] caller without `writeTagValues` permission → 403

---

## Tag.writeCommand (Device command)
> target: telemetry/src/modules/tag/__tests__/tag-value.test.ts
> plan-task: 9

### happy path
- POST /tags/:id/command with { value } on writable tag with binding → HTTP call to Node-RED endpoint, returns 200
- no historian record created (command path does not write to historian)

### constraints
- tag not found → 404
- tag not writable (writable=false) → 403
- tag has no binding → 400
- EdgeDevice for binding.deviceKey not found → 404
- Node-RED HTTP call fails → 502

### authorization
- [CRITICAL] caller without `sendTagCommands` permission → 403

---

## Historian.compactValues
> target: telemetry/src/modules/historian/__tests__/historian.service.test.ts
> plan-task: 12

### happy path
- range with multiple samples → returns [{ t, v }] array sorted by time
- [HIGH] always prepends last value before range start as opening baseline (stateful timeline)

### constraints
- tagId not found or no historian data → empty array
- from/to missing → validation error

---

## Historian.samples
> target: telemetry/src/modules/historian/__tests__/historian.service.test.ts
> plan-task: 12

### happy path
- range query → returns paginated raw samples with all fields (prevValue, prevTs, etc.)
- ?previous=true → prepends last sample before range start

### constraints
- from/to missing → validation error

### boundaries
- ?previous=false or omitted → no prepend

### authorization
- [CRITICAL] caller without `readHistorian` permission → 403

---

## Historian.count
> target: telemetry/src/modules/historian/__tests__/historian.service.test.ts
> plan-task: 12

### happy path
- range with N samples → returns { count: N }

### constraints
- no data in range → returns { count: 0 }

---

## Historian.stats
> target: telemetry/src/modules/historian/__tests__/historian.service.test.ts
> plan-task: 12

### happy path
- range with samples → returns { min, max, mean, variance, stddev }

### constraints
- no data in range → appropriate empty/zero response

---

## Historian.produced (counter)
> target: telemetry/src/modules/historian/__tests__/counter.calc.test.ts
> plan-task: 10

### happy path
- no reset in range: values 09:59=100, 10:05=120, 10:10=130, range 10:00-10:10 → produced = 130 - 100 = 30
- single reset: values 09:59=100, 10:05=120, 10:06=0, 10:10=5, range 10:00-10:10 → produced = (5 - 100) + 120 = 25
- single doc in range: value=50, prevValue=45 → produced = 50 - 45 = 5

### edge cases
- [HIGH] multiple resets in range → each peak's prev2Value summed as compensation
- [HIGH] no samples in range → produced = 0
- [HIGH] opening baseline from last doc before range start (prevValue of first doc or baseline.value)
- range with only one doc and no predecessor → uses 0 as opening value

### authorization
- [CRITICAL] caller without `readHistorian` permission → 403

---

## Historian.speedAvg (speed)
> target: telemetry/src/modules/historian/__tests__/speed.calc.test.ts
> plan-task: 11

### happy path
- spec example: values 10:00:01=120, 10:00:07=90, 10:00:15=80, range 10:00:03-10:00:19 → segments: 120x4s + 90x8s + 80x4s = 1520, weightedAvg = 1520/16 = 95
- returns { totalArea, weightedAvg, durationSec }

### edge cases
- [HIGH] last known value before range used as initial segment value (stepwise-hold)
- [HIGH] last value carried to range end
- no baseline and no docs → returns { totalArea: 0, weightedAvg: 0, durationSec: 0 }
- no baseline but docs exist → initial value = 0 from rangeStart to first doc

### authorization
- [CRITICAL] caller without `readHistorian` permission → 403

---

## Historian.stateDurations (binary)
> target: telemetry/src/modules/historian/__tests__/binary.calc.test.ts
> plan-task: 12

### happy path
- binary tag with transitions in range → returns array of { state, start, end, durationMs } segments
- baseline (last value before range) used as initial state, first segment starts at rangeStart

### edge cases
- [HIGH] baseline exists, no transitions in range → single segment from rangeStart to rangeEnd with baseline state
- [HIGH] no baseline, single sample in range → single segment from sample.occurredAt to rangeEnd with sample.value
- [HIGH] no baseline, multiple samples in range → first segment starts at first sample's occurredAt (NOT rangeStart); state=first sample's value
- [CRITICAL] no baseline and no docs → returns `[]` (never assume default state)
- [HIGH] final segment always extends to rangeEnd (closing segment)
- deterministic ordering: ties on occurredAt broken by _id for both baseline and in-range docs

### authorization
- [CRITICAL] caller without `readHistorian` permission → 403

---

## Historian.latest
> target: telemetry/src/modules/historian/__tests__/historian.service.test.ts
> plan-task: 12

### happy path
- tag with historian samples → returns `{ tagId, value, occurredAt }` from the last persisted sample (sort `occurredAt desc, _id desc`)
- tag exists but historian collection is empty (no samples yet) → returns `null`

### constraints
- non-existent tagId → 404 `tag.not_found`
- [HIGH] only persisted samples are visible; samples dropped by `same_value`/`within_tolerance`/`out_of_order` filters do not appear here

### edge cases
- two samples with identical occurredAt → deterministic tiebreak via `_id desc`

### authorization
- [CRITICAL] caller without `readHistorian` permission → 403

---

## Historian.rollup
> target: telemetry/src/modules/historian/__tests__/historian.service.test.ts
> plan-task: 12

### happy path
- bucketed time-series with interval (e.g. '5m', '1h') and aggregation fn → returns array of bucketed values
- supported fn values: average, last, first, sum, min, max

### edge cases
- [HIGH] empty buckets → carry-forward last known value
- previous value used for carry-forward in leading empty buckets

### constraints
- invalid fn → validation error
- invalid interval format → validation error
- from/to missing → validation error

### authorization
- [CRITICAL] caller without `readHistorian` permission → 403

---

## Discovery.manifest (MQTT)
> target: telemetry/src/modules/discovery/__tests__/discovery.cache.test.ts
> plan-task: 13

### happy path
- MQTT message on `discovery/{deviceKey}/manifest` → nodes cached in-memory
- subsequent manifest from same device → cache overwritten (latest wins)

### constraints
- malformed JSON manifest → silently ignored

---

## Discovery.status (MQTT)
> target: telemetry/src/modules/discovery/__tests__/discovery.cache.test.ts
> plan-task: 13

### happy path
- MQTT message on `discovery/{deviceKey}/status` with 'online' → EdgeDevice.status updated to 'online' in DB
- LWT triggers 'offline' → EdgeDevice.status updated to 'offline' in DB

### constraints
- deviceKey not matching any EdgeDevice in DB → update fails silently (logged as warning)

---

## Discovery.list (API)
> target: telemetry/src/modules/discovery/__tests__/discovery.routes.test.ts
> plan-task: 13

### happy path
- GET /discovery → returns all cached device manifests with node lists

### authorization
- [CRITICAL] caller without `readDiscovery` permission → 403

---

## Discovery.getByDevice (API)
> target: telemetry/src/modules/discovery/__tests__/discovery.routes.test.ts
> plan-task: 13

### happy path
- GET /discovery/:deviceKey → returns manifest for specific device

### constraints
- deviceKey not in cache → returns null/empty

### authorization
- [CRITICAL] caller without `readDiscovery` permission → 403

---

## Events.publish (Redis Streams)
> target: telemetry/src/jobs/__tests__/events.test.ts
> plan-task: 14

### happy path
- tag created → `tag.created` event emitted to `events.telemetry` stream with { tagId }
- tag updated → `tag.updated` event emitted with { tagId }
- tag deleted → `tag.deleted` event emitted with { tagId }
- tag type created/updated/deleted → corresponding events emitted with { tagTypeId }
- edge device created/updated/deleted → corresponding events emitted with { edgeDeviceId }

---

## Events.periodClosure (Redis Streams consumer)
> target: telemetry/src/jobs/__tests__/subscribers.test.ts
> plan-task: 14

### happy path
- period closure event received with lockedBefore timestamp → in-memory lock variable set

### edge cases
- [HIGH] ingestion attempt with sample.time <= periodLockBefore → rejected (409 for REST, debug log for MQTT)
- [HIGH] no period closure received yet (lock=null) → all ingestion allowed

---

## Realtime.pubsub (Redis Pub/Sub)
> target: telemetry/src/modules/ingestion/__tests__/ingestion.pipeline.test.ts
> plan-task: 8

### happy path
- after sample persisted → Redis PUBLISH to `tag:{tagId}:value` with { tagId, value, occurredAt }

### edge cases
- Redis Pub/Sub publish fails → ingestion NOT affected (fire-and-forget, error swallowed)
