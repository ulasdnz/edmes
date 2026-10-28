# Test Scenarios: realtime-gateway

> Generated: 2026-03-28 | Spec: docs/superpowers/specs/2026-03-27-realtime-gateway-design.md | Plan: docs/superpowers/plans/2026-03-27-realtime-gateway.md
> Status: READY
> Immutable after implementation starts.
> To change: update this file, then re-run /write-scenario-tests.

---

## EventConsumer.catchAllFallback
> target: packages/events/src/consumer.test.ts
> plan-task: 1

### happy path
- event arrives with a registered handler for its type -> that specific handler is called with `(data, type)`
- event arrives with no specific handler but `'*'` handler registered -> `'*'` handler is called with `(data, type)`
- handler receives `type` as second argument -> type string matches `parsed.type`

### constraints
- specific handler takes priority over `'*'` -> when both exist for a type, only the specific handler is called
- no specific handler AND no `'*'` handler -> event is skipped (existing behavior preserved)

### edge cases
- [HIGH] both specific handler for `'foo.bar'` and `'*'` registered, event type is `'foo.bar'` -> only specific handler called, `'*'` NOT called
- `'*'` handler registered alongside multiple specific handlers -> `'*'` only called for types without a specific handler

---

## resolveRooms
> target: realtime/src/gateway/router.test.ts
> plan-task: 6

### happy path
- `type='job_order.started'`, `payload={ workCenterId: 'abc' }` -> `['job_order', 'wc:abc']`
- `type='role.updated'`, `payload={}` -> `['role']`
- `type='production_plan.created'`, `payload={}` -> `['production_plan']`
- `type='scrap_entry.created'`, `payload={ workCenterId: 'xyz', jobOrderId: '123' }` -> `['scrap_entry', 'wc:xyz']` (`jobOrderId` is NOT a routing key)

### constraints
- entity prefix room is always the first element -> derived from `type.split('.')[0]`
- `workCenterId` in payload -> adds `wc:{id}` room
- `previousWorkCenterId` in payload -> adds `wc:{previousId}` room
- `jobOrderId` in payload -> does NOT add a room (not a routing key)

### boundaries
- type with no dot (e.g. `'heartbeat'`) -> entire string is the prefix -> `['heartbeat']`
- type with multiple dots (`'work_center.operator.checked_in'`) -> only first segment -> room is `work_center`

### edge cases
- [HIGH] both `workCenterId='abc'` and `previousWorkCenterId='def'` present -> three rooms: `['job_order', 'wc:abc', 'wc:def']`
- [HIGH] `workCenterId='abc'` and `previousWorkCenterId='abc'` (same value) -> `['job_order', 'wc:abc', 'wc:abc']` (Socket.io deduplicates at emit time)
- empty payload `{}` -> only entity prefix room returned
- `workCenterId` is falsy (`null`, `undefined`, empty string) -> NOT added as routing room
- `previousWorkCenterId` is falsy -> NOT added as routing room

---

## SocketServer.joinHandler
> target: realtime/src/gateway/socket.test.ts
> plan-task: 7

### happy path
- client emits `join` with `{ rooms: ['wc:abc', 'job_order'] }` -> client joins both rooms
- client emits `join` with `{ rooms: ['production_plan'] }` -> client joins that single room

### constraints
- `join` replaces all current room subscriptions -> old rooms are left before new rooms are joined
- the default `socket.id` room is never left -> only non-default rooms are replaced
- `rooms` must be an array -> if not an array, join is a no-op

### boundaries
- `join` with empty array `{ rooms: [] }` -> all non-default rooms are left, no new rooms joined
- `join` with single room `{ rooms: ['wc:abc'] }` -> joins exactly one room

### edge cases
- [HIGH] second `join` call replaces first -> rooms from first call are left, rooms from second call are the only active ones
- `join` with missing `rooms` field `{}` -> no-op (`rooms` is `undefined`, not an array)
- `join` with `{ rooms: 'wc:abc' }` (string, not array) -> no-op
- `join` with `{ rooms: null }` -> no-op

---

## SocketServer.authentication
> target: realtime/src/gateway/socket.auth.test.ts
> added: 2026-10-28 (socket auth hardening)

### happy path
- client connects with a valid JWT in `auth.token` -> connection accepted, user resolved from the same auth context as REST
- user can see work center `abc` and emits `join` with `['wc:abc', 'job_order']` -> joins both, ack returns `{ rooms: ['wc:abc', 'job_order'] }`

### constraints
- [CRITICAL] no token -> connection rejected with `auth.unauthenticated`
- [CRITICAL] token signed with another secret -> connection rejected
- [HIGH] user deactivated in user-service -> connection rejected
- [CRITICAL] `wc:{id}` room the user cannot see -> skipped, not joined (same visibility rule as REST)
- auth-context request to user-service carries the internal API token

### edge cases
- [HIGH] event emitted to a work center room the user was denied -> client does not receive it
- non-string room entries -> skipped

---

## Subscribers.catchAllForwarding
> target: realtime/src/jobs/subscribers.test.ts
> plan-task: 8

### happy path
- event arrives on `events.production` stream -> `resolveRooms` called -> emitted to resolved rooms via Socket.io with event type as Socket.io event name
- event `job_order.started` with `{ workCenterId: 'abc' }` -> `io.to('job_order').to('wc:abc').emit('job_order.started', payload)`

### constraints
- consumer group name is `'realtime'`
- all three streams are subscribed: `events.user`, `events.work_center`, `events.production`
- `'*'` handler is used for all streams (no per-type handlers)

### edge cases
- event emitted to room with no connected clients -> no client transmission (Socket.io built-in)

---

## ScrapEntryEmit.create
> target: production/src/modules/scrap-entry/scrap-entry.service.test.ts
> plan-task: 3

### happy path
- `create()` succeeds -> calls `emitScrapEntryCreated(doc._id.toString(), doc.jobOrderId.toString(), doc.workCenterId.toString())`

### constraints
- [CRITICAL] all three params (`id`, `jobOrderId`, `workCenterId`) are passed as strings via `.toString()`

---

## ScrapEntryEmit.update
> target: production/src/modules/scrap-entry/scrap-entry.service.test.ts
> plan-task: 3

### happy path
- `update()` succeeds -> calls `emitScrapEntryUpdated(id, scrap.jobOrderId.toString(), scrap.workCenterId.toString())`

### constraints
- [CRITICAL] uses `scrap` (pre-update document) for routing fields, not `doc` (post-update)

---

## ScrapEntryEmit.remove
> target: production/src/modules/scrap-entry/scrap-entry.service.test.ts
> plan-task: 3

### happy path
- `remove()` succeeds -> calls `emitScrapEntryDeleted(id, doc.jobOrderId.toString(), doc.workCenterId.toString())`

### constraints
- [CRITICAL] routing fields are read from the document fetched before deletion

---

## QuantityAdjustmentEmit.create
> target: production/src/modules/quantity-adjustment/quantity-adjustment.service.test.ts
> plan-task: 3

### happy path
- `create()` succeeds -> calls `emitQuantityAdjustmentCreated(doc._id.toString(), doc.jobOrderId.toString(), doc.workCenterId.toString())`

### constraints
- [CRITICAL] all three params (`id`, `jobOrderId`, `workCenterId`) are passed as strings via `.toString()`

---

## QuantityAdjustmentEmit.update
> target: production/src/modules/quantity-adjustment/quantity-adjustment.service.test.ts
> plan-task: 3

### happy path
- `update()` succeeds -> calls `emitQuantityAdjustmentUpdated(id, qa.jobOrderId.toString(), qa.workCenterId.toString())`

### constraints
- [CRITICAL] uses `qa` (pre-update document) for routing fields, not `doc` (post-update)

---

## QuantityAdjustmentEmit.remove
> target: production/src/modules/quantity-adjustment/quantity-adjustment.service.test.ts
> plan-task: 3

### happy path
- `remove()` succeeds -> calls `emitQuantityAdjustmentDeleted(id, doc.jobOrderId.toString(), doc.workCenterId.toString())`

### constraints
- [CRITICAL] routing fields are read from the document fetched before deletion

---

## JobOrderEmit.updateWithPreviousWorkCenterId
> target: production/src/modules/job-order/job-order.service.test.ts
> plan-task: 3

### happy path
- `update()` with `data.workCenterId` different from `jo.workCenterId` -> calls `emitJobOrderUpdated(id, doc.workCenterId.toString(), jo.workCenterId.toString())`
- `update()` changes an unrelated field (e.g. `description`) and does NOT include `data.workCenterId` -> still calls `emitJobOrderUpdated(id, doc.workCenterId.toString(), undefined)` using the persisted/current work center

### constraints
- [CRITICAL] `previousWorkCenterId` is only set when `data.workCenterId` is truthy AND differs from `jo.workCenterId.toString()`
- comparison is string-based: `data.workCenterId !== jo.workCenterId.toString()`
- [CRITICAL] event payload still includes `doc.workCenterId.toString()` even when the PATCH payload omits `workCenterId` -> gateway can route the update to the current `wc:{id}` room

### boundaries
- `data.workCenterId === jo.workCenterId.toString()` (same value) -> `previousWorkCenterId` is `undefined`
- `data.workCenterId` is `undefined` (not in update payload) -> `previousWorkCenterId` is `undefined` (falsy short-circuit), but event still carries current `workCenterId`
- `data.workCenterId` is a new valid ObjectId string -> `previousWorkCenterId` is `jo.workCenterId.toString()`

---

## RealtimeConfig.validation
> target: realtime/src/config/config.test.ts
> plan-task: 5

### happy path
- valid env (`NODE_ENV=development`, `PORT=3003`, `REDIS_URL=redis://localhost:6379`) -> config object with correct types and values

### constraints
- `REDIS_URL` must be a valid `redis://` or `rediss://` URL with a host -> invalid URL -> `process.exit(1)`
- `REDIS_URL` must be non-empty -> empty string -> `process.exit(1)`
- `PORT` defaults to `3003` if not provided
- `NODE_ENV` defaults to `'development'` if not provided
- `LOG_LEVEL` defaults to `'info'` if not provided

### boundaries
- `REDIS_URL=rediss://secure-host:6380` (TLS) -> valid
- `REDIS_URL=http://localhost:6379` (wrong protocol) -> invalid
- `REDIS_URL=redis://` (no host) -> invalid

---

## SocketServer.configuration
> target: realtime/src/gateway/socket.test.ts
> plan-task: 7

### constraints
- transports set to `['websocket']` only -> no HTTP long-polling fallback
- CORS origin is `'*'`
