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
events.production  ──┤  "realtime"       │   realtime   │ ─────────► React (tablet)
events.scripts     ──┘                   │   service    │            Admin Panel
(future streams)                         └──────────────┘
```

The service follows the existing `user/` service pattern: same directory structure, same shared packages, same Docker conventions.

---

## Socket.io Room Structure

Every connected client is automatically joined to the `global` room.

Clients join additional rooms by emitting a `join` event after connecting:
```js
socket.emit('join', { workCenterIds: ['id1', 'id2', 'id3'] })
```

Each `join` call **replaces** the client's current workCenter room subscriptions — old rooms are left before joining new ones. This prevents room accumulation across multiple calls.

**Room types:**
- `global` — all connected clients. Receives operationally relevant events with no `workCenterId`.
- `workCenter:{id}` — clients that explicitly joined. Receives events scoped to that work center.
- `admin` — clients that explicitly joined. Receives system-level events (user/role changes, config). No clients join this room in v1; the room exists for when an admin panel is built.

**Client contract:** On every connect and reconnect, the client must re-emit `join` and re-fetch current state for all visible screens. Socket events are invalidation triggers, not a reliable event log — events emitted during a disconnect window are not replayed.

---

## Event Routing Rule

The gateway applies routing in two steps per event:

**Step 1 — Policy lookup:** Check the event type against the event policy table (see below). If the policy is `none`, consume and discard — do not forward to any browser.

**Step 2 — Room resolution:**
```
if payload.workCenterId is present:
  → emit to room workCenter:{workCenterId}
  if payload.previousWorkCenterId is present:
    → also emit to room workCenter:{previousWorkCenterId}
else if policy is 'global':
  → emit to room global
else if policy is 'admin':
  → emit to room admin
```

The Socket.io event name equals the Redis Stream event type:
```
Redis type: "job_order.started"
Socket.io:  socket.emit("job_order.started", { jobOrderId, workCenterId, ... })
```

Frontend listens per event type:
```js
socket.on('job_order.started', (data) => { ... })
socket.on('work_center.operator.checked_in', (data) => { ... })
```

---

## Event Policy Table

Defined in `gateway/event-policy.ts`. Every event type consumed by the gateway must have an explicit policy entry. Unknown event types are treated as `none`.

| Stream | Event type pattern | Policy | Room |
|--------|--------------------|--------|------|
| events.production | `job_order.*` | workCenter | `workCenter:{workCenterId}` |
| events.production | `scrap_entry.*` | workCenter | `workCenter:{workCenterId}` |
| events.production | `quantity_adjustment.*` | workCenter | `workCenter:{workCenterId}` |
| events.production | `production_plan.*` | global | `global` |
| events.production | `product.*` | global | `global` |
| events.production | `product_category.*` | global | `global` |
| events.production | `product_standard.*` | global | `global` |
| events.production | `uom.*` | admin | `admin` |
| events.work_center | `work_center.*` | workCenter | `workCenter:{workCenterId}` |
| events.user | `user.*` | admin | `admin` |
| events.user | `role.*` | admin | `admin` |
| events.user | `speciality.*` | admin | `admin` |

When a new service is added, its event types must be added to this table before the gateway is deployed.

---

## Transport

Socket.io configured in **WebSocket-only mode** — polling fallback disabled. On factory LAN, WebSocket is always available. This eliminates the need for sticky sessions.

**Single-instance constraint:** This service is designed for a single instance. Running multiple instances is not supported without a Socket.io Redis adapter — each instance holds its own in-process room state, and the Redis consumer group would distribute events across instances, causing clients on one instance to miss events consumed by another. If horizontal scaling is needed in the future, add `@socket.io/redis-adapter`.

**Delivery guarantee:** This service provides best-effort delivery. Consumer name is process-based (`pid`), so pending messages from a crashed instance are not recovered on restart — they remain stranded in the consumer group. This is acceptable: if the gateway crashes, all socket connections drop and clients reconnect, triggering a full state refresh. Events emitted during the crash window are intentionally lost. This gateway is an invalidation signal bus, not a reliable event log.

**No authentication on WebSocket connections.** The system is on-premises, factory LAN only. Accepted risk: any LAN-internal client can connect and join any `workCenter:{id}` or `admin` room without credential verification. This is a deliberate trade-off — the REST API layer enforces auth for all data reads, so a rogue subscriber can receive event notifications but cannot act on them without valid credentials.

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

`emitJobOrderUpdated` — add `previousWorkCenterId?: string` parameter (job order can be reassigned to a different work center).

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
│   │   ├── router.ts             # resolveRooms(type, payload) → string[]
│   │   └── event-policy.ts       # EVENT_POLICY map: type → 'workCenter'|'global'|'admin'|'none'
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

Takes the event type (for policy lookup) and the payload (for workCenterId). Returns the list of Socket.io rooms to emit to — empty array means the event is dropped. No side effects, no dependencies.

---

## Infrastructure

**Docker Compose additions:**
- New `realtime` service block
- `depends_on: redis` only (no MongoDB dependency)
- Internal port: `3000` (same convention as all services)
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
