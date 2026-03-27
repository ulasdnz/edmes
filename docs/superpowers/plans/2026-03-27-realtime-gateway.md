# Realtime Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `realtime/` service that consumes all Redis Streams and forwards events to browser clients via Socket.io.

**Architecture:** Single process, WebSocket-only Socket.io server. Consumes Redis Streams via `@mes/events` catch-all (`'*'`) handler. Routes events to Socket.io rooms derived from event type prefix and payload routing keys. No DB, no REST calls, no auth.

**Tech Stack:** Node.js 20, Express 5, Socket.io 4, ioredis 5, `@mes/events`, `@mes/health`, `@mes/logger`, `@mes/core`, Zod 4, Winston 3

**Spec:** `docs/superpowers/specs/2026-03-27-realtime-gateway-design.md`

---

## File Structure

```
Changes to existing files:
  packages/events/src/types.ts          — extend EventHandler signature
  packages/events/src/consumer.ts       — add '*' fallback + pass type to handler
  production/src/jobs/events.ts         — enrich scrap/quantity emit functions
  production/src/modules/scrap-entry/scrap-entry.service.ts       — pass routing params to emit
  production/src/modules/quantity-adjustment/quantity-adjustment.service.ts — pass routing params to emit
  production/src/modules/job-order/job-order.service.ts           — pass previousWorkCenterId
  pnpm-workspace.yaml                  — add realtime workspace
  docker-compose.yml                   — add realtime service block

New files:
  realtime/package.json
  realtime/tsconfig.json
  realtime/.env
  realtime/src/config/index.ts          — PORT, REDIS_URL, NODE_ENV, LOG_LEVEL
  realtime/src/lib/redis.ts             — streamClient only (no keyPrefix)
  realtime/src/lib/logger.ts            — Winston logger (serviceName: 'realtime')
  realtime/src/lib/shutdown.ts          — re-export from @mes/core
  realtime/src/gateway/router.ts        — resolveRooms(type, payload) pure function
  realtime/src/gateway/socket.ts        — Socket.io server setup + join handler
  realtime/src/jobs/subscribers.ts      — '*' handler per stream, emit to Socket.io rooms
  realtime/src/core/loaders/index.ts    — redis init, express init
  realtime/src/core/loaders/express.ts  — health routes + error handler (no auth, no i18n)
  realtime/src/app.ts                   — http.Server bootstrap, socket.io + subscribers init, graceful shutdown
  realtime/Dockerfile
```

---

### Task 1: Extend `@mes/events` — EventHandler Signature + Catch-All Fallback

**Files:**
- Modify: `packages/events/src/types.ts:8`
- Modify: `packages/events/src/consumer.ts:56,72`

This task makes two backward-compatible changes to the shared events package so the gateway can register a single `'*'` handler that receives all events with their type.

- [ ] **Step 1: Update EventHandler type to include `type` parameter**

In `packages/events/src/types.ts`, change the `EventHandler` type:

```typescript
// was:
export type EventHandler = (data: any) => Promise<void>

// becomes:
export type EventHandler = (data: any, type: string) => Promise<void>
```

TypeScript allows a function with fewer parameters to be assigned to a type with more, so existing handlers `(data) => {}` remain valid without modification.

- [ ] **Step 2: Add `'*'` fallback in consumer and pass `type` to handler**

In `packages/events/src/consumer.ts`, inside the `processBatch` function:

Change handler lookup (line 56):
```typescript
// was:
const handler = handlers[parsed.type]

// becomes:
const handler = handlers[parsed.type] ?? handlers['*']
```

Change handler execution (line 72):
```typescript
// was:
const execute = () => handler(data)

// becomes:
const execute = () => handler(data, parsed.type)
```

- [ ] **Step 3: Build packages to verify no type errors**

Run: `pnpm build:packages`
Expected: Clean build with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/events/src/types.ts packages/events/src/consumer.ts
git commit -m "feat(events): add catch-all handler and type parameter to event handler"
```

---

### Task 2: Enrich Production Event Emit Functions

**Files:**
- Modify: `production/src/jobs/events.ts:77-91`

Add `jobOrderId` and `workCenterId` parameters to scrap entry and quantity adjustment emit functions so the gateway can route these events to the correct Socket.io rooms.

- [ ] **Step 1: Update scrap entry emit functions**

In `production/src/jobs/events.ts`, replace the scrap entry section (lines 84-91):

```typescript
// ── ScrapEntry events ───────────────────────────────────────────────────────

export const emitScrapEntryCreated = (
  scrapEntryId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('scrap_entry.created', { scrapEntryId, jobOrderId, workCenterId })
export const emitScrapEntryUpdated = (
  scrapEntryId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('scrap_entry.updated', { scrapEntryId, jobOrderId, workCenterId })
export const emitScrapEntryDeleted = (
  scrapEntryId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('scrap_entry.deleted', { scrapEntryId, jobOrderId, workCenterId })
```

- [ ] **Step 2: Update quantity adjustment emit functions**

In `production/src/jobs/events.ts`, replace the quantity adjustment section (lines 77-82):

```typescript
// ── QuantityAdjustment events ───────────────────────────────────────────────

export const emitQuantityAdjustmentCreated = (
  adjustmentId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('quantity_adjustment.created', { adjustmentId, jobOrderId, workCenterId })
export const emitQuantityAdjustmentUpdated = (
  adjustmentId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('quantity_adjustment.updated', { adjustmentId, jobOrderId, workCenterId })
export const emitQuantityAdjustmentDeleted = (
  adjustmentId: string,
  jobOrderId: string,
  workCenterId: string,
) => emit('quantity_adjustment.deleted', { adjustmentId, jobOrderId, workCenterId })
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm --filter production-service run typecheck`
Expected: Type errors in scrap-entry.service.ts and quantity-adjustment.service.ts (callers need updating — Task 3).

- [ ] **Step 4: Commit emit function changes**

```bash
git add production/src/jobs/events.ts
git commit -m "feat(production): enrich scrap and quantity emit functions with routing params"
```

---

### Task 3: Update Production Service Callers

**Files:**
- Modify: `production/src/modules/scrap-entry/scrap-entry.service.ts:36,131,138`
- Modify: `production/src/modules/quantity-adjustment/quantity-adjustment.service.ts:35,110,117`
- Modify: `production/src/modules/job-order/job-order.service.ts:171`

Update all emit call sites to pass the new routing parameters.

- [ ] **Step 1: Update scrap-entry.service.ts — create**

In `production/src/modules/scrap-entry/scrap-entry.service.ts`, the `create` function (around line 36). Change:

```typescript
// was:
emitScrapEntryCreated(doc._id.toString())

// becomes:
emitScrapEntryCreated(doc._id.toString(), doc.jobOrderId.toString(), doc.workCenterId.toString())
```

- [ ] **Step 2: Update scrap-entry.service.ts — update**

In the `update` function (around line 131). The `scrap` variable (fetched at line 108) already has `jobOrderId` and `workCenterId`. Change:

```typescript
// was:
emitScrapEntryUpdated(id)

// becomes:
emitScrapEntryUpdated(id, scrap.jobOrderId.toString(), scrap.workCenterId.toString())
```

Note: Use `scrap` (the original document fetched before update), not `doc` (the updated document). These fields are immutable on scrap entries so both have the same value, but using `scrap` is consistent — we read the document before the update for validation anyway.

- [ ] **Step 3: Update scrap-entry.service.ts — remove**

In the `remove` function (around line 138). Change:

```typescript
// was:
emitScrapEntryDeleted(id)

// becomes:
emitScrapEntryDeleted(id, doc.jobOrderId.toString(), doc.workCenterId.toString())
```

- [ ] **Step 4: Update quantity-adjustment.service.ts — create**

In `production/src/modules/quantity-adjustment/quantity-adjustment.service.ts`, the `create` function (around line 35). Change:

```typescript
// was:
emitQuantityAdjustmentCreated(doc._id.toString())

// becomes:
emitQuantityAdjustmentCreated(doc._id.toString(), doc.jobOrderId.toString(), doc.workCenterId.toString())
```

- [ ] **Step 5: Update quantity-adjustment.service.ts — update**

In the `update` function (around line 110). The `qa` variable (fetched at line 90) has the routing fields. Change:

```typescript
// was:
emitQuantityAdjustmentUpdated(id)

// becomes:
emitQuantityAdjustmentUpdated(id, qa.jobOrderId.toString(), qa.workCenterId.toString())
```

- [ ] **Step 6: Update quantity-adjustment.service.ts — remove**

In the `remove` function (around line 117). Change:

```typescript
// was:
emitQuantityAdjustmentDeleted(id)

// becomes:
emitQuantityAdjustmentDeleted(id, doc.jobOrderId.toString(), doc.workCenterId.toString())
```

- [ ] **Step 7: Update job-order.service.ts — update with previousWorkCenterId**

In `production/src/modules/job-order/job-order.service.ts`, the `update` function. The variable `jo` (fetched at line ~123 before the update) holds the old document. After `findOneAndUpdate` (line 165), change the emit call at line 171:

```typescript
// was:
emitJobOrderUpdated(id, doc.workCenterId.toString())

// becomes:
const previousWorkCenterId =
  data.workCenterId && data.workCenterId !== jo.workCenterId.toString()
    ? jo.workCenterId.toString()
    : undefined
emitJobOrderUpdated(id, doc.workCenterId.toString(), previousWorkCenterId)
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `pnpm --filter production-service run typecheck`
Expected: Clean typecheck — no errors.

- [ ] **Step 9: Commit**

```bash
git add production/src/modules/scrap-entry/scrap-entry.service.ts production/src/modules/quantity-adjustment/quantity-adjustment.service.ts production/src/modules/job-order/job-order.service.ts
git commit -m "feat(production): pass routing params to scrap, quantity, and job order emit calls"
```

---

### Task 4: Scaffold Realtime Service — package.json, tsconfig, workspace

**Files:**
- Create: `realtime/package.json`
- Create: `realtime/tsconfig.json`
- Create: `realtime/.env`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Create `realtime/package.json`**

```json
{
  "name": "realtime-service",
  "version": "1.0.0",
  "description": "Realtime gateway — bridges Redis Streams to Socket.io",
  "author": "Ulas Deniz Isik",
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "start": "node dist/app.js",
    "dev": "tsx watch src/app.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^25.3.5",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  },
  "dependencies": {
    "@mes/core": "workspace:*",
    "@mes/logger": "workspace:*",
    "@mes/events": "workspace:*",
    "@mes/health": "workspace:*",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "ioredis": "^5.10.0",
    "socket.io": "^4.8.1",
    "winston": "^3.19.0",
    "zod": "^4.3.6"
  },
  "type": "module"
}
```

- [ ] **Step 2: Create `realtime/tsconfig.json`**

```json
{
  "extends": "../tsconfig.app.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts", "**/*.spec.ts"],
  "references": [
    { "path": "../packages/core" },
    { "path": "../packages/logger" },
    { "path": "../packages/health" },
    { "path": "../packages/events" }
  ]
}
```

- [ ] **Step 3: Create `realtime/.env`**

```env
NODE_ENV=development
PORT=3003
REDIS_URL=redis://localhost:6379
LOG_LEVEL=debug
```

- [ ] **Step 4: Add `realtime` to `pnpm-workspace.yaml`**

Add `realtime` to the packages list:

```yaml
packages:
  - packages/*
  - apps/*
  - user
  - work-center
  - production
  - realtime
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: Lockfile updates, no errors.

- [ ] **Step 6: Commit**

```bash
git add realtime/package.json realtime/tsconfig.json realtime/.env pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(realtime): scaffold service with package.json, tsconfig, and workspace"
```

---

### Task 5: Config & Lib Files

**Files:**
- Create: `realtime/src/config/index.ts`
- Create: `realtime/src/lib/redis.ts`
- Create: `realtime/src/lib/logger.ts`
- Create: `realtime/src/lib/shutdown.ts`

- [ ] **Step 1: Create `realtime/src/config/index.ts`**

```typescript
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.resolve(__dirname, '../../.env')
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3003),
  LOG_LEVEL: z.string().default('info'),
  REDIS_URL: z
    .string()
    .nonempty('REDIS_URL must be provided')
    .refine(
      val => {
        try {
          const url = new URL(val)
          return (url.protocol === 'redis:' || url.protocol === 'rediss:') && !!url.host
        } catch {
          return false
        }
      },
      { message: 'REDIS_URL must be a valid redis URL like redis://host:port' },
    ),
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Environment validation failed:')
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = result.data
```

- [ ] **Step 2: Create `realtime/src/lib/logger.ts`**

```typescript
import { createLogger } from '@mes/logger'
import { config } from '../config/index.js'

export const logger = createLogger({ level: config.LOG_LEVEL, serviceName: 'realtime' })
```

- [ ] **Step 3: Create `realtime/src/lib/redis.ts`**

The realtime service only needs a single `streamClient` — no keyPrefix, no cache client, no shared client.

```typescript
import { Redis, type RedisOptions } from 'ioredis'
import { config } from '../config/index.js'
import { logger } from './logger.js'

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  connectTimeout: 10000,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 100, 2000)
    if (times === 1) {
      logger.warn('Redis: Reconnecting...', { event: 'redis.reconnecting', attempt: times })
    }
    if (times % 10 === 0) {
      logger.warn(`Redis: Still attempting to reconnect... (${times} attempts)`, {
        event: 'redis.reconnecting',
        attempt: times,
      })
    }
    return delay
  },
  reconnectOnError: err => err.message.includes('READONLY'),
  keepAlive: 10000,
}

export const streamClient = new Redis(config.REDIS_URL, baseOptions)

streamClient.on('error', err => {
  logger.error('Redis Stream Client Error', { event: 'redis.stream.error', error: err.message })
})
streamClient.on('connect', () =>
  logger.info('Redis: Stream connection established', { event: 'redis.stream.connected' }),
)
streamClient.on('ready', () =>
  logger.info('Redis: Stream client ready', { event: 'redis.stream.ready' }),
)
streamClient.on('reconnecting', () =>
  logger.warn('Redis: Stream client reconnecting...', { event: 'redis.stream.reconnecting' }),
)

export async function initRedis(): Promise<void> {
  await streamClient.connect()
  logger.info('Redis stream client connected', { event: 'redis.init.completed' })
}

export async function closeRedis(): Promise<void> {
  await streamClient.quit()
  logger.info('Redis stream client disconnected', { event: 'redis.close.completed' })
}
```

- [ ] **Step 4: Create `realtime/src/lib/shutdown.ts`**

```typescript
export { isShuttingDown, setShuttingDown } from '@mes/core'
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm --filter realtime-service run typecheck`
Expected: Errors about missing `app.ts` — that's fine, we haven't created it yet. Config/lib files should have no type errors.

- [ ] **Step 6: Commit**

```bash
git add realtime/src/config/index.ts realtime/src/lib/redis.ts realtime/src/lib/logger.ts realtime/src/lib/shutdown.ts
git commit -m "feat(realtime): add config, redis, logger, and shutdown lib files"
```

---

### Task 6: Event Router — `resolveRooms`

**Files:**
- Create: `realtime/src/gateway/router.ts`

A single pure function. No side effects, no dependencies, no configuration.

- [ ] **Step 1: Create `realtime/src/gateway/router.ts`**

```typescript
export function resolveRooms(type: string, payload: Record<string, unknown>): string[] {
  const rooms = [type.split('.')[0]]

  if (payload.workCenterId) rooms.push(`wc:${payload.workCenterId}`)
  if (payload.previousWorkCenterId) rooms.push(`wc:${payload.previousWorkCenterId}`)

  return rooms
}
```

- [ ] **Step 2: Commit**

```bash
git add realtime/src/gateway/router.ts
git commit -m "feat(realtime): add resolveRooms event routing function"
```

---

### Task 7: Socket.io Server Setup

**Files:**
- Create: `realtime/src/gateway/socket.ts`

Socket.io configured in WebSocket-only mode. Single `join` event handler that replaces room subscriptions.

- [ ] **Step 1: Create `realtime/src/gateway/socket.ts`**

```typescript
import type http from 'http'
import { Server } from 'socket.io'
import { logger } from '../lib/logger.js'

let io: Server

export function initSocketServer(httpServer: http.Server): Server {
  io = new Server(httpServer, {
    transports: ['websocket'],
    cors: { origin: '*' },
  })

  io.on('connection', socket => {
    logger.debug('Client connected', {
      event: 'socket.client.connected',
      socketId: socket.id,
    })

    socket.on('join', (data: { rooms?: string[] }) => {
      const rooms = data?.rooms
      if (!Array.isArray(rooms)) return

      // Leave all current rooms except the default socket.id room
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room)
      }

      for (const room of rooms) {
        socket.join(room)
      }

      logger.debug('Client joined rooms', {
        event: 'socket.client.joined',
        socketId: socket.id,
        rooms,
      })
    })

    socket.on('disconnect', reason => {
      logger.debug('Client disconnected', {
        event: 'socket.client.disconnected',
        socketId: socket.id,
        reason,
      })
    })
  })

  logger.info('Socket.io server initialized (WebSocket-only)', {
    event: 'socket.server.initialized',
  })

  return io
}

export function getIO(): Server {
  return io
}
```

- [ ] **Step 2: Commit**

```bash
git add realtime/src/gateway/socket.ts
git commit -m "feat(realtime): add socket.io server with join handler"
```

---

### Task 8: Stream Subscribers — Catch-All Handler

**Files:**
- Create: `realtime/src/jobs/subscribers.ts`

Registers a `'*'` handler per stream. Each event is resolved to rooms and emitted via Socket.io.

- [ ] **Step 1: Create `realtime/src/jobs/subscribers.ts`**

```typescript
import { runInContext } from '@mes/core'
import { createStreamConsumer } from '@mes/events'
import { getIO } from '../gateway/socket.js'
import { resolveRooms } from '../gateway/router.js'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const GROUP = 'realtime'
const CONSUMER_ID = `rt-${process.pid}`

const catchAll = async (data: Record<string, unknown>, type: string): Promise<void> => {
  const rooms = resolveRooms(type, data)
  const io = getIO()

  let target = io
  for (const room of rooms) {
    target = target.to(room) as typeof io
  }
  target.emit(type, data)

  logger.debug('Event forwarded', {
    event: 'gateway.event.forwarded',
    eventType: type,
    rooms,
  })
}

const streams: Record<string, Record<string, typeof catchAll>> = {
  'events.user': { '*': catchAll },
  'events.work_center': { '*': catchAll },
  'events.production': { '*': catchAll },
}

const consumer = createStreamConsumer({
  redis: streamClient,
  group: GROUP,
  consumer: CONSUMER_ID,
  streams,
  logger,
  runInContext: (traceId, fn) => runInContext({ traceId, ip: 'internal' }, fn),
})

export const initSubscribers = () => {
  consumer.start().catch(err => {
    logger.error('Stream consumer crashed', {
      event: 'events.consumer.crashed',
      error: err instanceof Error ? err.message : err,
    })
  })
}

export const shutdownSubscribers = () => {
  consumer.stop()
}
```

- [ ] **Step 2: Commit**

```bash
git add realtime/src/jobs/subscribers.ts
git commit -m "feat(realtime): add stream subscribers with catch-all handler"
```

---

### Task 9: App Bootstrap — Loaders & `app.ts`

**Files:**
- Create: `realtime/src/core/loaders/index.ts`
- Create: `realtime/src/app.ts`

The key difference from other services: `app.ts` creates the `http.Server` and passes it to both Express (for `/health`) and Socket.io. Single port, single process.

- [ ] **Step 1: Create `realtime/src/core/loaders/index.ts`**

No Mongoose, no i18n, no auth. Just Redis + Express health routes + Socket.io + subscribers.

```typescript
import { logger } from '../../lib/logger.js'
import { initRedis } from '../../lib/redis.js'
import { initExpress } from './express.js'

export const initLoaders = async () => {
  try {
    logger.info('Initializing application loaders', { event: 'loader.init.started' })

    await initRedis()

    const app = await initExpress()

    logger.info('All loaders initialized successfully', { event: 'loader.init.completed' })
    return app
  } catch (error) {
    logger.error('Loader initialization failed', {
      event: 'loader.init.failed',
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    process.exit(1)
  }
}
```

- [ ] **Step 2: Create `realtime/src/core/loaders/express.ts`**

Minimal Express app — only health routes, no auth, no i18n, no API routes.

```typescript
import { createErrorHandler } from '@mes/core'
import { createHealthRoutes, redisProbe } from '@mes/health'
import express from 'express'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'
import { streamClient } from '../../lib/redis.js'

const errorHandler = createErrorHandler({ logger, nodeEnv: config.NODE_ENV })

export const initExpress = async () => {
  const app = express()

  const healthRoutes = createHealthRoutes({
    probes: [redisProbe(streamClient)],
    logger,
  })

  app.use(healthRoutes)
  app.use(errorHandler)

  return app
}
```

- [ ] **Step 3: Create `realtime/src/app.ts`**

```typescript
import http from 'http'
import { config } from './config/index.js'
import { initLoaders } from './core/loaders/index.js'
import { initSocketServer } from './gateway/socket.js'
import { initSubscribers, shutdownSubscribers } from './jobs/subscribers.js'
import { logger } from './lib/logger.js'
import { closeRedis } from './lib/redis.js'
import { isShuttingDown, setShuttingDown } from './lib/shutdown.js'

const SHUTDOWN_TIMEOUT_MS = 8000

const startServer = async (): Promise<void> => {
  try {
    const app = await initLoaders()

    const httpServer = http.createServer(app)
    initSocketServer(httpServer)
    initSubscribers()

    httpServer.listen(config.PORT, () => {
      logger.info('Server started', { event: 'server.start', port: config.PORT })
    })

    const shutdown = async (signal?: NodeJS.Signals): Promise<void> => {
      if (isShuttingDown) return
      setShuttingDown()

      logger.info('Gracefully shutting down', { event: 'server.shutdown.start', signal })

      const forceExitTimer = setTimeout(() => {
        logger.error('Shutdown timed out, forcing exit', {
          event: 'server.shutdown.timeout',
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
        })
        process.exit(1)
      }, SHUTDOWN_TIMEOUT_MS)
      forceExitTimer.unref()

      httpServer.close(async () => {
        logger.info('HTTP server closed', { event: 'server.http.closed' })

        try {
          await Promise.all([closeRedis(), shutdownSubscribers()])
          logger.info('Connections closed', { event: 'server.shutdown.completed' })
          process.exit(0)
        } catch (err) {
          logger.error('Error during shutdown cleanup', {
            event: 'server.shutdown.failed',
            error: err instanceof Error ? err.message : err,
          })
          process.exit(1)
        }
      })
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  } catch (err) {
    logger.error('Failed to start server', {
      event: 'server.start.failed',
      error: err instanceof Error ? err.message : err,
      stack: err instanceof Error ? err.stack : undefined,
    })
    process.exit(1)
  }
}

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled rejection', {
    event: 'process.unhandled_rejection',
    error: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  })
  process.exit(1)
})

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    event: 'process.uncaught_exception',
    error: error.message,
    stack: error.stack,
  })
  process.exit(1)
})

startServer()
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter realtime-service run typecheck`
Expected: Clean — no errors.

- [ ] **Step 5: Verify dev mode starts**

Run: `pnpm --filter realtime-service run dev`
Expected: Server starts on port 3003, connects to Redis (if running), logs initialization.
Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add realtime/src/core/loaders/index.ts realtime/src/core/loaders/express.ts realtime/src/app.ts
git commit -m "feat(realtime): add app bootstrap with loaders and graceful shutdown"
```

---

### Task 10: Dockerfile

**Files:**
- Create: `realtime/Dockerfile`

Follows the same two-phase build pattern as production/Dockerfile, but simpler — no i18n locales copy, no MongoDB.

- [ ] **Step 1: Create `realtime/Dockerfile`**

```dockerfile
# ---------------------------------------
# Stage 1: Build & Deploy
# ---------------------------------------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat git openssh-client && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.app.json tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/logger/package.json packages/logger/tsconfig.json ./packages/logger/
COPY packages/events/package.json packages/events/tsconfig.json ./packages/events/
COPY packages/health/package.json packages/health/tsconfig.json ./packages/health/
COPY packages/cache/package.json packages/cache/tsconfig.json ./packages/cache/
COPY packages/auth/package.json packages/auth/tsconfig.json ./packages/auth/
COPY packages/openapi/package.json packages/openapi/tsconfig.json ./packages/openapi/
COPY packages/testing/package.json packages/testing/tsconfig.json ./packages/testing/
COPY realtime/package.json realtime/tsconfig.json ./realtime/

RUN echo "node-linker=hoisted" > .npmrc && pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY realtime/ ./realtime/

RUN pnpm build:packages && pnpm --filter realtime-service run build

RUN pnpm --filter=realtime-service --prod deploy --legacy /prod/realtime

# ---------------------------------------
# Stage 2: Runner (Production Image)
# ---------------------------------------
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3003

COPY --from=builder /prod/realtime ./

RUN mkdir -p /app/logs && chown node:node /app/logs

USER node

EXPOSE 3003
CMD ["dumb-init", "node", "dist/app.js"]
```

- [ ] **Step 2: Commit**

```bash
git add realtime/Dockerfile
git commit -m "feat(realtime): add dockerfile with two-phase build"
```

---

### Task 11: Docker Compose & Traefik

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add realtime service block to `docker-compose.yml`**

Add the following block after the `production` service block (before `loki`):

```yaml
  realtime:
    build:
      context: .
      dockerfile: realtime/Dockerfile
    container_name: realtime_app
    restart: unless-stopped
    env_file:
      - ./realtime/.env
    environment:
      - REDIS_URL=${REDIS_URL:-redis://redis:6379}
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - mes_network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3003/health/ready"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=mes_network"
      - "traefik.http.routers.realtime.rule=PathPrefix(`/socket.io`)"
      - "traefik.http.routers.realtime.entrypoints=web"
      - "traefik.http.routers.realtime.priority=10"
      - "traefik.http.services.realtime.loadbalancer.server.port=3003"
    deploy:
      resources:
        limits:
          cpus: '0.25'
          memory: 256M
```

- [ ] **Step 2: Verify docker compose config is valid**

Run: `docker compose config --quiet`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(realtime): add service to docker-compose with traefik routing"
```

---

### Task 12: Build & Smoke Test

- [ ] **Step 1: Full build**

Run: `pnpm build:packages && pnpm --filter realtime-service run build`
Expected: Clean build, `realtime/dist/` directory created with compiled JS files.

- [ ] **Step 2: Docker build**

Run: `docker compose build realtime`
Expected: Image builds successfully.

- [ ] **Step 3: Docker compose up**

Run: `docker compose up -d --build realtime`
Expected: Container starts, health check passes.

Verify: `docker compose logs realtime --tail 20`
Expected: See `server.start`, `redis.stream.ready`, `socket.server.initialized` log entries.

- [ ] **Step 4: Quick Socket.io connection test**

From a terminal (or browser console):
```bash
npx wscat -c ws://localhost/socket.io/?EIO=4&transport=websocket
```
Expected: WebSocket connection established. Type `40` to send a Socket.io CONNECT packet, expect `40{"sid":"..."}` back.

- [ ] **Step 5: Commit any fixes if needed**

If any issues were found during smoke testing, fix them and commit:
```bash
git add -A
git commit -m "fix(realtime): address smoke test issues"
```
