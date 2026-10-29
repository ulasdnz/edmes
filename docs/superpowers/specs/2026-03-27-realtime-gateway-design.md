# Realtime Gateway Service — Design Spec

**Date:** 2026-03-27
**Status:** Approved

---

## Problem

Frontend clients (React, operator panels on tablets) need to receive real-time updates when backend state changes — job orders started/deleted, operators checked in, scrap entries created, etc. Services already publish these events to Redis Streams for service-to-service communication. There is no mechanism to bridge these events to browser clients.

---

## Solution

A new `realtime/` service that consumes all Redis Streams and forwards events to connected browser clients via Socket.io. It is the single WebSocket endpoint for the entire system.

**Single rule:** Everything that needs to reach the browser flows through Redis Streams → `realtime` gateway → Socket.io. The gateway makes no DB calls, no REST calls, no computations.

---

## Architecture

```
Redis Streams                  realtime service              Frontend
──────────────                 ────────────────              ────────
events.user        ──┐
events.work_center ──┤  consumer group   ┌──────────────┐  Socket.io
events.production  ──┘  "realtime"       │   realtime   │ ─────────► React frontend
(future streams)                         └──────────────┘
```

The service follows the existing `user/` service pattern: same directory structure, same shared packages, same Docker conventions.

---

## Socket.io Room Structure

No auto-join. Clients join only the rooms they need by emitting a `join` event after connecting:
```js
socket.emit('join', { rooms: ['wc:abc', 'wc:def', 'production_plan'] })
```

Each `join` call **replaces** the client's current room subscriptions — old rooms are left before joining new ones. This prevents room accumulation across multiple calls.

**Room types (convention-based, not configured):**
- **Entity prefix rooms** (`job_order`, `role`, `work_center`, `production_plan`, etc.) — derived from the event type. Every event is always emitted to its entity prefix room. Client joins if they want all events of that entity type regardless of work center.
- **Routing key rooms** (`wc:{id}`, future: `tag:{id}`) — derived from payload fields. Additionally emitted to when present. Client joins for entity-specific events.

**Examples:**

| Event | Rooms emitted to |
|-------|-----------------|
| `job_order.started` (workCenterId: abc) | `job_order`, `wc:abc` |
| `role.updated` (no routing key) | `role` |
| `production_plan.created` (no routing key) | `production_plan` |
| `tag.value.recorded` (tagId: 123) | `tag`, `tag:123` (only users with `readHistorian` receive it) |

If nobody has joined a room, the event is not transmitted — zero bandwidth.

**Client contract:** On every connect and reconnect, the client must re-emit `join` and re-fetch current state for all visible screens. Socket events are invalidation triggers, not a reliable event log — events emitted during a disconnect window are not replayed.

---

## Event Routing Rule

The gateway applies one routing function per event — no policy table, no event-type configuration:

```typescript
function resolveRooms(type: string, payload: Record<string, unknown>): string[] {
  const rooms = [type.split('.')[0]]  // entity prefix room

  if (payload.workCenterId) rooms.push(`wc:${payload.workCenterId}`)
  if (payload.previousWorkCenterId) rooms.push(`wc:${payload.previousWorkCenterId}`)
  // future routing keys (e.g. tagId) follow the same pattern

  return rooms
}
```

Socket.io deduplicates across chained `.to()` calls — each socket receives the event at most once even if it belongs to multiple matching rooms.

The Socket.io event name equals the Redis Stream event type:
```
Redis type: "job_order.started"
Socket.io:  emitToRooms(['job_order', 'wc:abc'], 'job_order.started', payload)
```

Frontend listens per event type:
```js
socket.on('job_order.started', (data) => { ... })
socket.on('work_center.operator.checked_in', (data) => { ... })
```

---

## Consumer API — Catch-All Handler

The existing `@mes/events` consumer dispatches events by exact type match (`handlers[parsed.type]`). The gateway cannot register a handler per event type — it must receive all events from each stream and apply the policy at runtime.

**Required changes to `@mes/events` (`packages/events/`):**

Two backward-compatible changes to the shared package:

**1. `types.ts` — extend `EventHandler` signature to include `type`:**
```typescript
// was: (data: any) => Promise<void>
export type EventHandler = (data: any, type: string) => Promise<void>
```
TypeScript allows a function with fewer parameters to be assigned to a type with more, so existing handlers `(data) => {}` remain valid without modification.

**2. `consumer.ts` — pass `type` to handler and add `'*'` fallback:**
```typescript
const handler = handlers[parsed.type] ?? handlers['*']
// ...
const execute = () => handler(data, parsed.type)  // was: handler(data)
```

The gateway registers a single `'*'` handler per stream. That handler receives both `data` and `type`, calls `resolveRooms(type, data)`, and emits to the resolved rooms via Socket.io. No per-type handler registration, no policy lookup — the routing function derives rooms purely from the event type prefix and payload fields.

---

## Transport

Socket.io configured in **WebSocket-only mode** — polling fallback disabled. On factory LAN, WebSocket is always available. This eliminates the need for sticky sessions.

**Single-instance constraint:** This service is designed for a single instance. Running multiple instances is not supported without a Socket.io Redis adapter — each instance holds its own in-process room state, and the Redis consumer group would distribute events across instances, causing clients on one instance to miss events consumed by another. If horizontal scaling is needed in the future, add `@socket.io/redis-adapter`.

**Delivery guarantee:** This service provides best-effort delivery. Consumer name is process-based (`pid`), so pending messages from a crashed instance are not recovered on restart — they remain stranded in the consumer group. This is acceptable: if the gateway crashes, all socket connections drop and clients reconnect, triggering a full state refresh. Events emitted during the crash window are intentionally lost. This gateway is an invalidation signal bus, not a reliable event log.

**Authentication and access.** Clients connect with `io(url, { auth: { token } })`. The handshake verifies the JWT through `resolveAuthUser` from `@mes/auth`, the same cached auth context REST uses, so deactivated users and tokens issued before a password change are rejected with `auth.unauthenticated`. If user-service cannot answer (error or 3-second timeout), the handshake fails with `auth.unavailable` instead, so clients retry rather than log out. Access follows one rule: a socket never receives what REST would hide from the same user.

- `wc:{id}` rooms can only be joined for visible work centers. The `join` ack lists the rooms actually joined.
- Every event is filtered per socket at delivery. An event with `workCenterId`, `previousWorkCenterId` or `workCenterIds` reaches a socket only if the user can see one of them, so entity rooms such as `job_order` do not leak other work centers.
- `tag.value.recorded` carries a measurement instead of IDs, so it needs `readHistorian`, the permission of the historian API. Tags have no owning work center, so tag values are scoped by permission, exactly like the historian API.
- Open sockets are re-checked every 30 seconds through the same auth context. Deactivated users, reset passwords and expired tokens are disconnected (`io server disconnect`); role and work center changes apply from the next event. If user-service cannot answer, sockets keep their last known auth.

---

## Stream Registration

The gateway subscribes to a static list of streams. When a new service is added, its stream is added to this list.

**Current streams:**
- `events.user`
- `events.work_center`
- `events.production`

New streams are added to this list when their service is created. The hookify `gateway-stream-registration` rule enforces this at development time.

Consumer group name: `realtime`

---

## Event Payload Rules (applied at source services, not gateway)

The gateway never enriches events. Routing keys must be present in the payload at publish time.

**Routing key rule:** If an event's entity has a `workCenterId`, the emit function must include it in the payload. This enables room routing without any gateway-side lookups.

**Ownership change rule:** When an update event can change the routing key field, the emit function includes `previousWorkCenterId?: string`. The service only includes this field when the value actually changed. Gateway emits to both rooms when present.

**Affected emit function updates (production service):**

`emitJobOrderUpdated` — signature already updated with `previousWorkCenterId?: string`. The real fix is in `job-order.service.ts`: the `update()` function fetches `jo` (old document) at line 123 before calling `findOneAndUpdate`. After the update, compare `jo.workCenterId` with `data.workCenterId` — if changed, pass the old value as `previousWorkCenterId`. Without this service-layer fix, `previousWorkCenterId` is always `undefined` and old-room routing never fires.

```typescript
// job-order.service.ts — update() function, after findOneAndUpdate
const previousWorkCenterId =
  data.workCenterId && data.workCenterId !== jo.workCenterId.toString()
    ? jo.workCenterId.toString()
    : undefined
emitJobOrderUpdated(id, doc.workCenterId.toString(), previousWorkCenterId)
```

`emitScrapEntryCreated/Updated/Deleted` — add `jobOrderId` and `workCenterId` parameters (already stored in schema, just not emitted).

`emitQuantityAdjustmentCreated/Updated/Deleted` — add `jobOrderId` and `workCenterId` parameters (already stored in schema, just not emitted).

---

## Service File Structure

```
realtime/
├── src/
│   ├── config/
│   │   └── index.ts              # PORT, REDIS_URL
│   ├── lib/
│   │   ├── redis.ts              # streamClient (no keyPrefix)
│   │   ├── logger.ts
│   │   └── shutdown.ts
│   ├── gateway/
│   │   ├── socket.ts             # Socket.io server setup, join handler
│   │   └── router.ts             # resolveRooms(type, payload) → string[]
│   ├── jobs/
│   │   └── subscribers.ts        # creates stream consumers for all streams
│   ├── core/loaders/
│   │   └── index.ts              # redis + socket.io init, no mongoose
│   └── app.ts
├── package.json
├── tsconfig.json
└── Dockerfile
```

**http.Server ownership:** `app.ts` creates the Node.js `http.Server` and passes it to both Express (for `/health`) and Socket.io:
```typescript
const httpServer = http.createServer(expressApp)
const io = new Server(httpServer, { transports: ['websocket'] })
httpServer.listen(PORT)
```
Socket.io attaches to the same server — single port, single process.

`router.ts` exports a single pure function:
```typescript
export function resolveRooms(type: string, payload: Record<string, unknown>): string[]
```

Derives the entity prefix from `type` and checks payload for routing keys (`workCenterId`, `previousWorkCenterId`, future: `tagId`). Returns the list of Socket.io rooms to emit to. No side effects, no dependencies, no configuration — the entire routing logic is ~5 lines.

---

## Infrastructure

**Docker Compose additions:**
- New `realtime` service block
- `depends_on: redis` only (no MongoDB dependency)
- Internal port: `3003` (user: 3000, work-center: 3001, production: 3002)
- Healthcheck: `GET /health`

**Traefik routing:**
- Rule: `PathPrefix(\`/socket.io\`)`
- No sticky session needed (WebSocket-only, single instance)

---

## What This Service Does NOT Do

- No database access
- No REST API calls to other services
- No computed/aggregated data push (badge counts etc.) — Phase 2 if needed
- No authentication on WebSocket connections
- No event persistence or replay
- No wildcard stream subscription — all streams explicitly listed
