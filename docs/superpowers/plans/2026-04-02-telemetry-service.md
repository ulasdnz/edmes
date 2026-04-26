# Telemetry Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the telemetry service for MQTT ingestion, historian storage, tag-based calculations, and config entity CRUD.

**Architecture:** Express 5 service following `user/` patterns exactly. MQTT.js for Mosquitto broker connection, per-tag MongoDB collections for historian data, in-process memory caches for binding lookup and predecessor tracking, Redis Pub/Sub for realtime value notifications, Redis Streams for config change events.

**Tech Stack:** Express 5, Mongoose 9, Zod 4, ioredis 5, mqtt.js 5, i18next 25, Vitest

**Spec:** `docs/superpowers/specs/2026-04-01-telemetry-service-design.md`

---

## File Structure

```
telemetry/
├── src/
│   ├── app.ts
│   ├── config/
│   │   └── index.ts
│   ├── constants/
│   │   └── privileges.ts
│   ├── core/
│   │   ├── loaders/
│   │   │   ├── index.ts
│   │   │   ├── express.ts
│   │   │   ├── i18n.ts
│   │   │   └── mongoose.ts
│   │   ├── middleware/
│   │   │   ├── error-handler.ts
│   │   │   ├── request-context.ts
│   │   │   └── validate.ts
│   │   └── types/
│   │       ├── api.types.ts
│   │       ├── express.d.ts
│   │       └── mongo.types.ts
│   ├── lib/
│   │   ├── cache.ts
│   │   ├── logger.ts
│   │   ├── mqtt.ts                           ← NEW
│   │   ├── redis.ts
│   │   ├── shutdown.ts
│   │   ├── openapi/
│   │   │   └── setup.ts
│   │   └── plugins/
│   │       ├── audit-log.model.ts
│   │       └── audit-log.plugin.ts
│   ├── modules/
│   │   ├── tag-type/
│   │   │   ├── tag-type.model.ts
│   │   │   ├── tag-type.controller.ts
│   │   │   ├── tag-type.service.ts
│   │   │   ├── tag-type.routes.ts
│   │   │   └── tag-type.validators.ts
│   │   ├── edge-device/
│   │   │   ├── edge-device.model.ts
│   │   │   ├── edge-device.controller.ts
│   │   │   ├── edge-device.service.ts
│   │   │   ├── edge-device.routes.ts
│   │   │   └── edge-device.validators.ts
│   │   ├── tag/
│   │   │   ├── tag.model.ts
│   │   │   ├── tag.controller.ts
│   │   │   ├── tag.service.ts
│   │   │   ├── tag.routes.ts
│   │   │   └── tag.validators.ts
│   │   ├── ingestion/
│   │   │   ├── binding-cache.ts              ← NEW
│   │   │   ├── predecessor-cache.ts          ← NEW
│   │   │   ├── ingestion.pipeline.ts         ← NEW
│   │   │   ├── historian.repository.ts       ← NEW
│   │   │   └── current-state.repository.ts   ← NEW
│   │   ├── historian/
│   │   │   ├── historian.controller.ts
│   │   │   ├── historian.service.ts
│   │   │   ├── historian.routes.ts
│   │   │   ├── historian.validators.ts
│   │   │   └── calculations/
│   │   │       ├── counter.calc.ts           ← NEW
│   │   │       ├── speed.calc.ts             ← NEW
│   │   │       └── binary.calc.ts            ← NEW
│   │   └── discovery/
│   │       ├── discovery.cache.ts            ← NEW
│   │       ├── discovery.controller.ts
│   │       └── discovery.routes.ts
│   ├── jobs/
│   │   ├── events.ts
│   │   └── subscribers.ts
│   └── utils/
│       ├── db.ts
│       ├── validators.ts
│       └── lang/
│           ├── en/translation.json
│           └── tr/translation.json
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env
├── .env.example
└── vitest.config.ts
```

**Pattern source:** `user/` service. Files not marked "NEW" follow the exact same structure as their `user/src/` counterparts, adapted for telemetry domain. The implementing agent MUST read the corresponding `user/src/` file before creating each telemetry file.

---

## Task 1: Service Scaffold

**Goal:** Create the telemetry service directory with package.json, tsconfig, env config, and basic app entry point. Service should start (and immediately exit since no DB yet).

**Files:**
- Create: `telemetry/package.json`
- Create: `telemetry/tsconfig.json`
- Create: `telemetry/.env`
- Create: `telemetry/.env.example`
- Create: `telemetry/src/config/index.ts`
- Create: `telemetry/src/app.ts`
- Create: `telemetry/vitest.config.ts`
- Modify: `pnpm-workspace.yaml` (already has `telemetry` — verify)
- Modify: `tsconfig.json` (root — add telemetry reference)

- [ ] **Step 1: Create `telemetry/package.json`**

Follow `user/package.json` exactly. Key differences:
- `name`: `telemetry-service`
- `description`: `Telemetry microservice for MES — MQTT ingestion, historian, tag calculations`
- Add `mqtt` dependency (mqtt.js 5)
- Remove user-specific deps: `bcryptjs`, `jsonwebtoken`, `multer`, `uuid`
- Keep: `express`, `mongoose`, `ioredis`, `zod`, `zod-openapi`, `winston`, `i18next`, `i18next-fs-backend`, `i18next-http-middleware`, `dotenv`, `cors`, `compression`, `helmet`, `morgan`, `winston-daily-rotate-file`
- Keep all `@mes/*` workspace deps
- Keep all devDependencies

```bash
cd telemetry && pnpm install
```

- [ ] **Step 2: Create `telemetry/tsconfig.json`**

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
    { "path": "../packages/cache" },
    { "path": "../packages/core" },
    { "path": "../packages/openapi" },
    { "path": "../packages/auth" },
    { "path": "../packages/logger" },
    { "path": "../packages/health" },
    { "path": "../packages/events" }
  ]
}
```

- [ ] **Step 3: Add telemetry to root `tsconfig.json` references**

Add `{ "path": "telemetry" }` to the references array in root `tsconfig.json`.

- [ ] **Step 4: Create `telemetry/src/config/index.ts`**

Follow `user/src/config/index.ts` pattern. Env schema differences:
- Remove: `JWT_EXPIRES_IN`, `INTERNAL_API_USER`, `SYSTEM_ADMIN_*`, `USER_DELETION_*`, `LOGIN_*` (token creation / user-service specific)
- Keep: `JWT_SECRET` (required for verifying incoming JWT tokens via `@mes/auth` middleware)
- Add: `MQTT_URL` (string, starts with `mqtt://` or `mqtts://`), `MQTT_USERNAME` (string), `MQTT_PASSWORD` (string)
- Keep: `NODE_ENV`, `PORT`, `MONGO_URI`, `LOG_LEVEL`, `REDIS_URL`, `MONGO_INDEX_STRATEGY`

- [ ] **Step 5: Create `.env` and `.env.example`**

```env
NODE_ENV=development
PORT=3001
MONGO_URI=mongodb://localhost:27017/mes_telemetry?directConnection=true
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-change-in-production
MQTT_URL=mqtt://localhost:1883
MQTT_USERNAME=mes_service
MQTT_PASSWORD=dev123
LOG_LEVEL=debug
```

- [ ] **Step 6: Create boilerplate files copied from user service**

Copy and adapt these files from `user/src/` — read each source file first:
- `src/lib/logger.ts` — change service name in logger metadata
- `src/lib/redis.ts` — change `keyPrefix` to `'telemetry:'`, add `pubClient` for Pub/Sub
- `src/lib/cache.ts` — same pattern
- `src/lib/shutdown.ts` — copy as-is
- `src/utils/db.ts` — copy as-is
- `src/utils/validators.ts` — copy as-is
- `src/core/middleware/error-handler.ts` — copy as-is
- `src/core/middleware/request-context.ts` — copy as-is
- `src/core/middleware/validate.ts` — copy as-is
- `src/core/types/api.types.ts` — copy as-is
- `src/core/types/express.d.ts` — copy as-is
- `src/core/types/mongo.types.ts` — copy as-is
- `src/core/types/index.ts` — copy as-is
- `src/lib/plugins/audit-log.model.ts` — copy as-is
- `src/lib/plugins/audit-log.plugin.ts` — copy as-is
- `src/lib/openapi/setup.ts` — copy as-is

**Important for `redis.ts`:** Add a `pubClient` (no keyPrefix) for Redis Pub/Sub publishing. This is separate from `streamClient` which is for Redis Streams.

```typescript
// Add to redis.ts alongside existing clients:
export const pubClient = new Redis(REDIS_URL, baseOptions)
pubClient.on('error', err => {
  logger.error('Redis Pub Client Error:', { error: err.message })
})
```

Update `initRedis` to connect `pubClient`, update `closeRedis` to quit it.

- [ ] **Step 7: Create minimal `src/app.ts`**

Copy from `user/src/app.ts`. In shutdown, add MQTT disconnect (placeholder — MQTT client created in Task 6).

- [ ] **Step 8: Create minimal loaders**

- `src/core/loaders/mongoose.ts` — copy from user
- `src/core/loaders/i18n.ts` — copy from user, adjust lang path
- `src/core/loaders/express.ts` — minimal: helmet, cors, json, compression, i18n, health routes, error handler. No module routes yet.
- `src/core/loaders/index.ts` — initMongoose, initRedis, initExpress (no MQTT yet)

- [ ] **Step 9: Create translation stubs**

- `src/utils/lang/en/translation.json` — `{ "success": { "create": "Created", "update": "Updated", "delete": "Deleted" } }`
- `src/utils/lang/tr/translation.json` — `{ "success": { "create": "Olusturuldu", "update": "Guncellendi", "delete": "Silindi" } }`

- [ ] **Step 10: Create `vitest.config.ts`**

Copy from `user/vitest.config.ts`.

- [ ] **Step 11: Verify service starts**

```bash
cd telemetry && pnpm dev
```

Expected: Server starts on port 3001, healthcheck responds (MongoDB/Redis errors expected if not running — that's fine for scaffold).

- [ ] **Step 12: Commit**

```bash
git add telemetry/ tsconfig.json
git commit -m "feat(telemetry): scaffold service with config, loaders, and infrastructure"
```

---

## Task 2: Docker & Compose Integration

**Goal:** Add telemetry service to docker-compose.yml with Dockerfile, Traefik routing, and healthcheck.

**Files:**
- Create: `telemetry/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create `telemetry/Dockerfile`**

Copy `user/Dockerfile` exactly. Key changes:
- Replace all `user/` paths with `telemetry/`
- Add `COPY telemetry/package.json telemetry/tsconfig.json ./telemetry/` in builder stage
- Change deploy filter: `pnpm --filter=telemetry-service --prod deploy --legacy /prod/telemetry`
- Copy i18n lang files: `RUN mkdir -p telemetry/dist/utils/lang && cp -r telemetry/src/utils/lang/* telemetry/dist/utils/lang/`
- Port: `EXPOSE 3001`, `ENV PORT=3001`

- [ ] **Step 2: Add telemetry service to `docker-compose.yml`**

Add after user service block. Follow user service pattern:

```yaml
telemetry:
  build:
    context: .
    dockerfile: telemetry/Dockerfile
  container_name: telemetry_app
  restart: unless-stopped
  volumes:
    - telemetry_uploads:/app/uploads
  env_file:
    - ./telemetry/.env
  environment:
    - MONGO_URI=${MONGO_URI:-mongodb://mongodb:27017/mes_telemetry?directConnection=true}
    - REDIS_URL=${REDIS_URL:-redis://redis:6379}
    - MQTT_URL=${MQTT_URL:-mqtt://mosquitto:1883}
    - MQTT_USERNAME=${MQTT_USERNAME:-mes_service}
    - MQTT_PASSWORD=${MQTT_PASSWORD:-dev123}
  depends_on:
    mongodb:
      condition: service_healthy
    redis:
      condition: service_healthy
    mosquitto:
      condition: service_healthy
  networks:
    - mes_network
  healthcheck:
    test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3001/health/ready"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 15s
  labels:
    - "traefik.enable=true"
    - "traefik.docker.network=mes_network"
    - "traefik.http.routers.telemetry.rule=PathPrefix(`/api/v1/tags`) || PathPrefix(`/api/v1/tag-types`) || PathPrefix(`/api/v1/edge-devices`) || PathPrefix(`/api/v1/historian`) || PathPrefix(`/api/v1/discovery`)"
    - "traefik.http.routers.telemetry.entrypoints=web"
    - "traefik.http.routers.telemetry.priority=20"
    - "traefik.http.services.telemetry.loadbalancer.server.port=3001"
```

Add `telemetry_uploads:` to named volumes.

- [ ] **Step 3: Build and verify**

```bash
docker compose up -d --build telemetry
docker compose ps telemetry
```

Expected: telemetry container healthy.

- [ ] **Step 4: Create MQTT test script**

Create `telemetry/scripts/test-mqtt.sh` — end-to-end MQTT ingestion test without OPC-UA simulator:

```bash
#!/bin/bash
# Publishes test telemetry messages to Mosquitto for E2E verification.
# Usage: ./telemetry/scripts/test-mqtt.sh

BROKER="localhost"
PORT=1883
USER="mes_service"
PASS="dev123"

echo "Publishing counter samples..."
mosquitto_pub -h $BROKER -p $PORT -u $USER -P $PASS \
  -t "devices/press-line-1/nodes/counter01" \
  -m '{"time":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","value":100}'

sleep 1

mosquitto_pub -h $BROKER -p $PORT -u $USER -P $PASS \
  -t "devices/press-line-1/nodes/counter01" \
  -m '{"time":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","value":105}'

echo "Publishing binary sample..."
mosquitto_pub -h $BROKER -p $PORT -u $USER -P $PASS \
  -t "devices/press-line-1/nodes/run01" \
  -m '{"time":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","value":1}'

echo "Done. Check telemetry service logs for ingestion output."
```

OPC-UA simulator + Node-RED flow setup is deferred — this script covers telemetry service E2E without edge infrastructure dependency.

- [ ] **Step 5: Commit**

```bash
git add telemetry/Dockerfile docker-compose.yml telemetry/scripts/test-mqtt.sh
git commit -m "build(telemetry): add Dockerfile, docker-compose entry, and MQTT test script"
```

---

## Task 3: TagType CRUD Module

**Goal:** Full CRUD for TagType entity. Follow `user/src/modules/role/` pattern exactly.

**Spec reference:** Section 2 (TagType definition), Section 18 (audit fields)

**Files:**
- Create: `telemetry/src/modules/tag-type/tag-type.model.ts`
- Create: `telemetry/src/modules/tag-type/tag-type.validators.ts`
- Create: `telemetry/src/modules/tag-type/tag-type.service.ts`
- Create: `telemetry/src/modules/tag-type/tag-type.controller.ts`
- Create: `telemetry/src/modules/tag-type/tag-type.routes.ts`
- Create: `telemetry/src/constants/privileges.ts`
- Modify: `telemetry/src/core/loaders/express.ts` (mount routes)

- [ ] **Step 1: Create privileges**

```typescript
// telemetry/src/constants/privileges.ts
export const PRIVILEGES = {
  readTagTypes: { code: 'readTagTypes', name: 'Read Tag Types', module: 'telemetry' },
  createTagTypes: { code: 'createTagTypes', name: 'Create Tag Types', module: 'telemetry' },
  writeTagTypes: { code: 'writeTagTypes', name: 'Write Tag Types', module: 'telemetry' },
  deleteTagTypes: { code: 'deleteTagTypes', name: 'Delete Tag Types', module: 'telemetry' },
  readEdgeDevices: { code: 'readEdgeDevices', name: 'Read Edge Devices', module: 'telemetry' },
  createEdgeDevices: { code: 'createEdgeDevices', name: 'Create Edge Devices', module: 'telemetry' },
  writeEdgeDevices: { code: 'writeEdgeDevices', name: 'Write Edge Devices', module: 'telemetry' },
  deleteEdgeDevices: { code: 'deleteEdgeDevices', name: 'Delete Edge Devices', module: 'telemetry' },
  readTags: { code: 'readTags', name: 'Read Tags', module: 'telemetry' },
  createTags: { code: 'createTags', name: 'Create Tags', module: 'telemetry' },
  writeTags: { code: 'writeTags', name: 'Write Tags', module: 'telemetry' },
  deleteTags: { code: 'deleteTags', name: 'Delete Tags', module: 'telemetry' },
  readHistorian: { code: 'readHistorian', name: 'Read Historian Data', module: 'telemetry' },
  writeTagValues: { code: 'writeTagValues', name: 'Write Tag Values', module: 'telemetry' },
  sendTagCommands: { code: 'sendTagCommands', name: 'Send Tag Commands', module: 'telemetry' },
  readDiscovery: { code: 'readDiscovery', name: 'Read Discovery Data', module: 'telemetry' },
} as const

export const VALID_PRIVILEGE_CODES = new Set(Object.values(PRIVILEGES).map(p => p.code))
```

- [ ] **Step 2: Create TagType model**

```typescript
// telemetry/src/modules/tag-type/tag-type.model.ts
import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const tagTypeSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    desc: { type: String, default: null },
    unit: { type: String, default: null, trim: true },
    displayColor: { type: String, default: null, trim: true },
    manualEntryMode: {
      type: String,
      enum: ['none', 'number', 'boolean'],
      default: 'none',
    },
  },
  {
    timestamps: true,
    strict: true,
    toObject: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        delete ret.__v
        return ret
      },
    },
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        delete ret.__v
        return ret
      },
    },
  },
)

export type ITagType = InferSchemaType<typeof tagTypeSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

tagTypeSchema.plugin(auditLogPlugin)

const TagType = model<ITagType>('TagType', tagTypeSchema)
export default TagType
```

- [ ] **Step 3: Create validators, service, controller, routes**

Follow `user/src/modules/role/` pattern exactly for each file:

**tag-type.validators.ts:** Zod schemas for create (name required, unit/displayColor/manualEntryMode optional), update (all optional), id param.

**tag-type.service.ts:** CRUD functions — `createTagType`, `getTagTypes`, `getTagTypeById`, `updateTagType`, `deleteTagType`. Check name uniqueness on create/update. Emit events (Task 14).

**tag-type.controller.ts:** Thin controller wrappers. Use `req.t('success.create')` etc.

**tag-type.routes.ts:** Standard REST with `requirePermission`.

- [ ] **Step 4: Mount routes in express loader**

Add tagType routes to `mountSharedRoutes` in `express.ts`. Configure auth (follow user service pattern — `configureAuth` with JWT secret and cache).

- [ ] **Step 5: Write tests**

Create `telemetry/src/modules/tag-type/__tests__/tag-type.service.test.ts`. Test CRUD operations with testcontainers (`@testcontainers/mongodb`). Follow existing test patterns in `user/`.

- [ ] **Step 6: Run tests**

```bash
cd telemetry && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(telemetry): add tag-type CRUD module"
```

---

## Task 4: EdgeDevice CRUD Module

**Goal:** Full CRUD for EdgeDevice entity.

**Spec reference:** Section 14 (EdgeDevice definition), Section 18 (audit fields)

**Files:**
- Create: `telemetry/src/modules/edge-device/edge-device.model.ts`
- Create: `telemetry/src/modules/edge-device/edge-device.validators.ts`
- Create: `telemetry/src/modules/edge-device/edge-device.service.ts`
- Create: `telemetry/src/modules/edge-device/edge-device.controller.ts`
- Create: `telemetry/src/modules/edge-device/edge-device.routes.ts`
- Modify: `telemetry/src/core/loaders/express.ts` (mount routes)

- [ ] **Step 1: Create EdgeDevice model**

```typescript
const edgeDeviceSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    deviceKey: { type: String, required: true, unique: true, trim: true, immutable: true },
    desc: { type: String, default: null },
    ipAddress: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['online', 'offline', 'unknown'],
      default: 'unknown',
    },
  },
  { timestamps: true, strict: true, /* same toObject/toJSON transforms */ },
)
```

Fields: `name`, `deviceKey` (unique, immutable, slug format `^[a-z0-9][a-z0-9-]*[a-z0-9]$`), `desc`, `ipAddress`, `status` (online/offline/unknown). `deviceKey` is the external MQTT identity — used in topics and tag bindings. Audit fields via `timestamps: true` + `auditLogPlugin`.

- [ ] **Step 2: Create validators, service, controller, routes**

Same pattern as TagType. CRUD operations. Name uniqueness check. `deviceKey` uniqueness check. `deviceKey` validated with regex `^[a-z0-9][a-z0-9-]*[a-z0-9]$` at Zod level. `deviceKey` is immutable — update rejects changes to it.

- [ ] **Step 3: Write tests and verify**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(telemetry): add edge-device CRUD module"
```

---

## Task 5: Tag CRUD Module

**Goal:** Full CRUD for Tag entity with optional binding.

**Spec reference:** Section 5 (Tag fields), Section 14 (binding rules)

**Files:**
- Create: `telemetry/src/modules/tag/tag.model.ts`
- Create: `telemetry/src/modules/tag/tag.validators.ts`
- Create: `telemetry/src/modules/tag/tag.service.ts`
- Create: `telemetry/src/modules/tag/tag.controller.ts`
- Create: `telemetry/src/modules/tag/tag.routes.ts`
- Modify: `telemetry/src/core/loaders/express.ts` (mount routes)

- [ ] **Step 1: Create Tag model**

```typescript
const bindingSchema = new Schema(
  {
    deviceKey: { type: String, required: true },
    nodeId: { type: String, default: null },
  },
  { _id: false },
)

const tagSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    desc: { type: String, default: null },
    tagTypeId: { type: Schema.Types.ObjectId, required: true },
    behavior: {
      type: String,
      enum: ['counter', 'speed', 'binary'],
      required: true,
    },
    storageMode: {
      type: String,
      enum: ['history', 'stateOnly'],
      default: 'history',
    },
    digit: { type: Number, default: 1 },
    tolerance: { type: Number, default: 0 },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    writable: { type: Boolean, default: false },
    showOnGraph: { type: Boolean, default: false },
    retentionPolicy: { type: String, default: null },
    binding: { type: bindingSchema, default: null },
    props: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, strict: true, /* same transforms */ },
)
```

Key points:
- `digit`, `tolerance`, `min`, `max` only meaningful for counter/speed — validated at Zod level, not schema level.
- `binding` is optional (null = virtual/unbound tag).
- `behavior` is immutable after data collection starts (validated in service — update rejects behavior change if historian data exists).

- [ ] **Step 2: Create validators**

Zod schemas:
- `createTagSchema`: name required, tagTypeId required (objectId), behavior required (enum), storageMode optional, digit/tolerance/min/max optional (only when behavior !== 'binary'), writable optional, binding optional ({ deviceKey: string, nodeId?: string }).
- `updateTagSchema`: all optional except behavior (not updatable).
- Binding uniqueness: if binding with `nodeId` provided, validate `deviceKey:nodeId` combination is not already bound to another tag. Bindings without `nodeId` skip uniqueness check (unbound node).

- [ ] **Step 3: Create service**

CRUD functions. On create/update/delete:
- Update binding cache (Task 7) synchronously.
- Emit Redis Streams events (Task 14).
- On create with `storageMode: 'history'`: the per-tag collection is created lazily on first sample insert (not at tag creation time).

Validate binding uniqueness (only when `nodeId` is present): query `Tag.findOne({ 'binding.deviceKey': deviceKey, 'binding.nodeId': nodeId, _id: { $ne: tagId } })`.

**Deletion guard:** `storageMode: 'history'` olan tag'lerde, `tag_samples_{tagId}` collection'ı varsa ve boş değilse silme reddedilir (409 Conflict). Admin açıkça veri kaybını kabul ediyorsa `?forceDelete=true` query param ile silme yapılabilir — bu durumda historian collection da drop edilir. Binding cache ve predecessor cache temizlenir.

- [ ] **Step 4: Create controller, routes, mount**

Standard pattern. Routes: GET /tags, GET /tags/:id, POST /tags, PATCH /tags/:id, DELETE /tags/:id.

- [ ] **Step 5: Write tests and verify**

Test binding uniqueness, behavior validation, CRUD operations, historian deletion guard (reject if historian data exists, allow with forceDelete=true).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(telemetry): add tag CRUD module with binding support"
```

---

## Task 6: MQTT Client

**Goal:** Connect to Mosquitto broker, subscribe to telemetry and discovery topics, dispatch messages.

**Spec reference:** Section 15 (MQTT contract, connection requirements), Section 14 (discovery topics)

**Files:**
- Create: `telemetry/src/lib/mqtt.ts`
- Modify: `telemetry/src/core/loaders/index.ts` (add MQTT init)
- Modify: `telemetry/src/app.ts` (add MQTT disconnect to shutdown)

- [ ] **Step 1: Create MQTT client**

```typescript
// telemetry/src/lib/mqtt.ts
import mqtt, { type MqttClient } from 'mqtt'
import { config } from '../config/index.js'
import { logger } from './logger.js'

let client: MqttClient | null = null

export const initMqtt = async (): Promise<void> => {
  const { MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD } = config

  client = mqtt.connect(MQTT_URL, {
    clientId: `aimes-telemetry-${process.pid}`,
    protocolVersion: 5,
    clean: false,
    connectTimeout: 30_000,
    reconnectPeriod: 10_000,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    properties: {
      sessionExpiryInterval: 300,
      receiveMaximum: 2500,
    },
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('MQTT connection timeout'))
    }, 30_000)

    client!.on('connect', () => {
      clearTimeout(timeout)
      logger.info('MQTT connected', { event: 'mqtt.connected', broker: MQTT_URL })

      // Subscribe to telemetry and discovery topics
      client!.subscribe(
        ['devices/+/nodes/+', 'discovery/+/manifest', 'discovery/+/status'],
        { qos: 1 },
        (err) => {
          if (err) {
            logger.error('MQTT subscribe failed', { event: 'mqtt.subscribe.failed', error: err.message })
            return reject(err)
          }
          logger.info('MQTT subscribed to topics', { event: 'mqtt.subscribed' })
          resolve()
        },
      )
    })

    client!.on('error', (err) => {
      logger.error('MQTT error', { event: 'mqtt.error', error: err.message })
    })

    client!.on('reconnect', () => {
      logger.warn('MQTT reconnecting', { event: 'mqtt.reconnecting' })
    })

    client!.on('offline', () => {
      logger.warn('MQTT offline', { event: 'mqtt.offline' })
    })
  })
}

export const onMqttMessage = (handler: (topic: string, payload: Buffer) => void): void => {
  if (!client) throw new Error('MQTT client not initialized')
  client.on('message', handler)
}

export const getMqttClient = (): MqttClient => {
  if (!client) throw new Error('MQTT client not initialized')
  return client
}

export const closeMqtt = async (): Promise<void> => {
  if (client) {
    await client.endAsync()
    logger.info('MQTT disconnected', { event: 'mqtt.disconnected' })
  }
}
```

- [ ] **Step 2: Add MQTT to loaders**

In `src/core/loaders/index.ts`, add `await initMqtt()` after `initRedis()`.

- [ ] **Step 3: Add MQTT to shutdown**

In `src/app.ts`, add `closeMqtt()` to the `Promise.all` in shutdown.

- [ ] **Step 4: Verify MQTT connects**

```bash
cd telemetry && pnpm dev
```

Expected: logs show `MQTT connected` and `MQTT subscribed to topics`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(telemetry): add MQTT client with persistent session and topic subscriptions"
```

---

## Task 7: Ingestion Caches

**Goal:** Build the two in-process caches: binding lookup and predecessor.

**Spec reference:** Section 7 (Predecessor Cache, Binding Lookup Cache)

**Files:**
- Create: `telemetry/src/modules/ingestion/binding-cache.ts`
- Create: `telemetry/src/modules/ingestion/predecessor-cache.ts`

- [ ] **Step 1: Write binding cache tests**

Test: set/get/delete binding, lookup by `deviceKey:nodeId`, cache miss returns undefined, binding without nodeId not cached (MQTT needs both).

- [ ] **Step 2: Implement binding cache**

```typescript
// telemetry/src/modules/ingestion/binding-cache.ts
import type { ITag } from '../tag/tag.model.js'

const cache = new Map<string, ITag>()

const key = (deviceKey: string, nodeId: string) => `${deviceKey}:${nodeId}`

export const bindingCacheSet = (tag: ITag): void => {
  if (!tag.binding?.nodeId) return // MQTT routing needs both deviceKey and nodeId
  cache.set(key(tag.binding.deviceKey, tag.binding.nodeId), tag)
}

export const bindingCacheGet = (deviceKey: string, nodeId: string): ITag | undefined =>
  cache.get(key(deviceKey, nodeId))

export const bindingCacheDelete = (deviceKey: string, nodeId: string): void => {
  cache.delete(key(deviceKey, nodeId))
}

/** Load all bound tags from DB into cache. Called once at startup. */
export const bindingCacheInit = async (): Promise<void> => {
  const Tag = (await import('../tag/tag.model.js')).default
  const tags = await Tag.find({ 'binding.nodeId': { $ne: null } }).lean()
  for (const tag of tags) {
    bindingCacheSet(tag as ITag)
  }
}

export const bindingCacheSize = () => cache.size
```

- [ ] **Step 3: Write predecessor cache tests**

Test: set/get/delete, lazy load from DB, counter includes prev2.

- [ ] **Step 4: Implement predecessor cache**

```typescript
// telemetry/src/modules/ingestion/predecessor-cache.ts

interface PredecessorEntry {
  value: number
  occurredAt: Date
  prevValue: number | null
  prevTs: Date | null
  prev2Value?: number | null
  prev2Ts?: Date | null
}

const cache = new Map<string, PredecessorEntry>()

export const predecessorGet = (tagId: string): PredecessorEntry | undefined =>
  cache.get(tagId)

export const predecessorSet = (tagId: string, entry: PredecessorEntry): void => {
  cache.set(tagId, entry)
}

export const predecessorDelete = (tagId: string): void => {
  cache.delete(tagId)
}

/**
 * Lazy-load: fetch the last sample from the tag's historian collection.
 * Returns undefined if no historian data exists.
 */
export const predecessorLoad = async (tagId: string, behavior: string): Promise<PredecessorEntry | undefined> => {
  const existing = cache.get(tagId)
  if (existing) return existing

  const mongoose = (await import('mongoose')).default
  const collectionName = `tag_samples_${tagId}`

  // Check if collection exists
  const collections = await mongoose.connection.db!.listCollections({ name: collectionName }).toArray()
  if (collections.length === 0) return undefined

  const collection = mongoose.connection.db!.collection(collectionName)
  const lastDoc = await collection.findOne({}, { sort: { occurredAt: -1 } })
  if (!lastDoc) return undefined

  const entry: PredecessorEntry = {
    value: lastDoc.value,
    occurredAt: lastDoc.occurredAt,
    prevValue: lastDoc.prevValue ?? null,
    prevTs: lastDoc.prevTs ?? null,
  }

  if (behavior === 'counter') {
    entry.prev2Value = lastDoc.prev2Value ?? null
    entry.prev2Ts = lastDoc.prev2Ts ?? null
  }

  cache.set(tagId, entry)
  return entry
}
```

- [ ] **Step 5: Run tests**

```bash
cd telemetry && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(telemetry): add binding lookup and predecessor in-process caches"
```

---

## Task 8: Ingestion Pipeline

**Goal:** Process incoming MQTT messages through the full ingestion pipeline: parse → lookup → filter → enrich → persist → notify.

**Spec reference:** Section 7 (all ingestion rules), Section 6 (sample schemas)

**Files:**
- Create: `telemetry/src/modules/ingestion/ingestion.pipeline.ts`
- Create: `telemetry/src/modules/ingestion/historian.repository.ts`
- Create: `telemetry/src/modules/ingestion/current-state.repository.ts`
- Modify: `telemetry/src/core/loaders/index.ts` (wire MQTT messages to pipeline)

- [ ] **Step 1: Write ingestion pipeline tests**

Core test scenarios:
1. Valid counter message → sample persisted with predecessor fields
2. Duplicate value (same value, newer time) → dropped (dedup)
3. Out-of-order message (time <= last) → dropped
4. Tolerance below threshold → dropped
5. Counter reset detection → `reset: true` on sample
6. Binary state change → persisted; same state → dropped
7. stateOnly tag → current_states updated, no historian append
8. Unbound topic → silently dropped

- [ ] **Step 2: Implement historian repository**

```typescript
// telemetry/src/modules/ingestion/historian.repository.ts
import mongoose from 'mongoose'

export interface CounterSample {
  occurredAt: Date
  value: number
  prevValue: number | null
  prevTs: Date | null
  prev2Value: number | null
  prev2Ts: Date | null
  reset: boolean
}

export interface SpeedSample {
  occurredAt: Date
  value: number
  prevValue: number | null
  prevTs: Date | null
}

export interface BinarySample {
  occurredAt: Date
  value: number
  prevValue: number | null
  prevTs: Date | null
}

export type HistorianSample = CounterSample | SpeedSample | BinarySample

export const insertSample = async (tagId: string, sample: HistorianSample): Promise<void> => {
  const collectionName = `tag_samples_${tagId}`
  const collection = mongoose.connection.db!.collection(collectionName)
  await collection.insertOne(sample)
}
```

- [ ] **Step 3: Implement current-state repository**

```typescript
// telemetry/src/modules/ingestion/current-state.repository.ts
import mongoose from 'mongoose'

const COLLECTION = 'current_states'

export const upsertCurrentState = async (
  tagId: string,
  value: number,
  occurredAt: Date,
): Promise<void> => {
  const collection = mongoose.connection.db!.collection(COLLECTION)
  await collection.updateOne(
    { tagId },
    { $set: { tagId, value, occurredAt, updatedAt: new Date() } },
    { upsert: true },
  )
}
```

- [ ] **Step 4: Implement ingestion pipeline**

```typescript
// telemetry/src/modules/ingestion/ingestion.pipeline.ts
import CustomError from '@mes/core/errors'
import { logger } from '../../lib/logger.js'
import { pubClient } from '../../lib/redis.js'
import type { ITag } from '../tag/tag.model.js'
import { getPeriodLock } from '../../jobs/subscribers.js'
import { bindingCacheGet } from './binding-cache.js'
import { upsertCurrentState } from './current-state.repository.js'
import { insertSample, type HistorianSample } from './historian.repository.js'
import { predecessorGet, predecessorLoad, predecessorSet } from './predecessor-cache.js'

interface IncomingMessage {
  time: string
  value: number
}

/** Route MQTT message to correct processing path */
export const processMessage = async (topic: string, payload: Buffer): Promise<void> => {
  // Parse topic: devices/{deviceKey}/nodes/{nodeId}
  const parts = topic.split('/')
  if (parts.length !== 4 || parts[0] !== 'devices' || parts[2] !== 'nodes') return

  const deviceKey = parts[1]
  const nodeId = parts[3]

  // Binding lookup
  const tag = bindingCacheGet(deviceKey, nodeId)
  if (!tag) return // silently drop unbound messages

  // Parse payload
  let msg: IncomingMessage
  try {
    msg = JSON.parse(payload.toString())
  } catch {
    return // malformed JSON, drop
  }

  const occurredAt = new Date(msg.time)
  if (Number.isNaN(occurredAt.getTime())) return // invalid time

  await ingestValue(tag, msg.value, occurredAt)
}

/** Core ingestion logic — shared by MQTT and REST value write */
export const ingestValue = async (tag: ITag, rawValue: number, occurredAt: Date): Promise<void> => {
  const tagId = tag._id.toString()

  // Period closure lock check — hard reject (REST needs 409, MQTT handler catches)
  const lock = getPeriodLock()
  if (lock && occurredAt.getTime() <= lock.getTime()) {
    throw new CustomError(409, 'historian.period_locked')
  }

  // Load predecessor (lazy)
  const pred = await predecessorLoad(tagId, tag.behavior)

  // Out-of-order check
  if (pred && occurredAt.getTime() <= pred.occurredAt.getTime()) return

  // Round value (digit)
  let value = rawValue
  if (tag.behavior !== 'binary' && tag.digit != null) {
    const factor = 10 ** tag.digit
    value = Math.round(rawValue * factor) / factor
  }

  // Dedup: same value as predecessor
  if (pred && value === pred.value) return

  // Tolerance check (counter & speed only)
  if (tag.behavior !== 'binary' && tag.tolerance > 0 && pred) {
    if (Math.abs(value - pred.value) < tag.tolerance) return
  }

  // Binary: only record state change
  if (tag.behavior === 'binary' && pred && value === pred.value) return

  // stateOnly: just update current state
  if (tag.storageMode === 'stateOnly') {
    await upsertCurrentState(tagId, value, occurredAt)
    await publishRealtimeValue(tagId, value, occurredAt)
    predecessorSet(tagId, { value, occurredAt, prevValue: pred?.value ?? null, prevTs: pred?.occurredAt ?? null })
    return
  }

  // Build sample
  const sample = buildSample(tag.behavior, value, occurredAt, pred)

  // Persist
  await insertSample(tagId, sample)

  // Update predecessor cache
  const newPred = {
    value,
    occurredAt,
    prevValue: pred?.value ?? null,
    prevTs: pred?.occurredAt ?? null,
    ...(tag.behavior === 'counter' ? {
      prev2Value: pred?.prevValue ?? null,
      prev2Ts: pred?.prevTs ?? null,
    } : {}),
  }
  predecessorSet(tagId, newPred)

  // Publish realtime
  await publishRealtimeValue(tagId, value, occurredAt)
}

function buildSample(
  behavior: string,
  value: number,
  occurredAt: Date,
  pred: { value: number; occurredAt: Date; prevValue: number | null; prevTs: Date | null; prev2Value?: number | null; prev2Ts?: Date | null } | undefined,
): HistorianSample {
  const prevValue = pred?.value ?? null
  const prevTs = pred?.occurredAt ?? null

  if (behavior === 'counter') {
    const prev2Value = pred?.prevValue ?? null
    const prev2Ts = pred?.prevTs ?? null

    // Peak detection for reset
    let reset = false
    if (prev2Value != null && prevValue != null) {
      reset = (prev2Value > value && value > prevValue) ||
              (prev2Value > prevValue && prevValue > value)
    }

    return { occurredAt, value, prevValue, prevTs, prev2Value, prev2Ts, reset }
  }

  // speed or binary
  return { occurredAt, value, prevValue, prevTs }
}

async function publishRealtimeValue(tagId: string, value: number, occurredAt: Date): Promise<void> {
  try {
    await pubClient.publish(
      `tag:${tagId}:value`,
      JSON.stringify({ tagId, value, occurredAt }),
    )
  } catch {
    // fire-and-forget — don't fail ingestion for pub/sub errors
  }
}
```

- [ ] **Step 5: Wire MQTT messages to pipeline**

In the loader or a dedicated wiring file, after MQTT init:

```typescript
import CustomError from '@mes/core/errors'
import { onMqttMessage } from '../../lib/mqtt.js'
import { processMessage } from '../../modules/ingestion/ingestion.pipeline.js'
import { logger } from '../../lib/logger.js'

onMqttMessage((topic, payload) => {
  // Discovery messages handled separately (Task 13)
  if (topic.startsWith('devices/')) {
    processMessage(topic, payload).catch(err => {
      // Period lock is expected rejection — debug only, not error (avoids log spam)
      if (err instanceof CustomError && err.message === 'historian.period_locked') {
        logger.debug('Ingestion rejected: period locked', { event: 'ingestion.period_locked', topic })
        return
      }
      logger.error('Ingestion error', { event: 'ingestion.error', topic, error: err.message })
    })
  }
})
```

- [ ] **Step 6: Run tests**

```bash
cd telemetry && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(telemetry): add ingestion pipeline with filtering, dedup, tolerance, and reset detection"
```

---

## Task 9: REST Value Write & Device Command

**Goal:** Two endpoints — REST value write for virtual tags, device write command via HTTP to Node-RED.

**Spec reference:** Section 16 (Tag Value Write Paths)

**Files:**
- Create: `telemetry/src/modules/tag/tag-value.controller.ts`
- Create: `telemetry/src/modules/tag/tag-value.validators.ts`
- Modify: `telemetry/src/modules/tag/tag.routes.ts` (add value/command routes)

- [ ] **Step 1: Write tests**

Test scenarios:
1. POST /tags/:id/values — valid payload → 201, sample persisted
2. POST /tags/:id/values — time <= last → 409 error
3. POST /tags/:id/command — writable tag → 200, HTTP call to Node-RED
4. POST /tags/:id/command — non-writable tag → 403
5. POST /tags/:id/command — no binding → 400

- [ ] **Step 2: Create validators**

```typescript
// telemetry/src/modules/tag/tag-value.validators.ts
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'

export const writeValueSchema = z.object({
  time: z.string().datetime(),
  value: z.number(),
}).strict()

export const writeCommandSchema = z.object({
  value: z.union([z.number(), z.boolean()]),
}).strict()

export const tagIdParamSchema = z.object({
  id: objectIdSchema,
})

export type WriteValueInput = z.infer<typeof writeValueSchema>
export type WriteCommandInput = z.infer<typeof writeCommandSchema>
```

- [ ] **Step 3: Implement controller**

```typescript
// telemetry/src/modules/tag/tag-value.controller.ts
import type { Request, Response } from 'express'
import CustomError from '../../core/errors/index.js'
import { logger } from '../../lib/logger.js'
import { ingestValue } from '../ingestion/ingestion.pipeline.js'
import Tag from './tag.model.js'
import type { WriteCommandInput, WriteValueInput } from './tag-value.validators.js'

export const writeValue = async (
  req: Request<{ id: string }, unknown, WriteValueInput>,
  res: Response,
) => {
  const tag = await Tag.findById(req.params.id)
  if (!tag) throw new CustomError(404, 'tag.not_found')

  await ingestValue(tag, req.body.value, new Date(req.body.time))

  res.status(201).json({ data: undefined, message: req.t('success.create') })
}

export const writeCommand = async (
  req: Request<{ id: string }, unknown, WriteCommandInput>,
  res: Response,
) => {
  const tag = await Tag.findById(req.params.id)
  if (!tag) throw new CustomError(404, 'tag.not_found')
  if (!tag.writable) throw new CustomError(403, 'tag.not_writable')
  if (!tag.binding) throw new CustomError(400, 'tag.no_binding')

  // Lookup EdgeDevice for IP
  const EdgeDevice = (await import('../edge-device/edge-device.model.js')).default
  const device = await EdgeDevice.findOne({ deviceKey: tag.binding.deviceKey }).lean()
  if (!device) throw new CustomError(404, 'edge_device.not_found')

  // HTTP call to Node-RED
  const url = `http://${device.ipAddress}:1880/api/nodes/${tag.binding.nodeId}/write`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: req.body.value }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    logger.warn('Node-RED write failed', {
      event: 'tag.command.failed',
      tagId: req.params.id,
      status: response.status,
    })
    throw new CustomError(502, 'tag.command_failed')
  }

  res.json({ data: undefined, message: req.t('success.update') })
}
```

- [ ] **Step 4: Add routes**

```typescript
// Add to tag.routes.ts
router.post(
  '/tags/:id/values',
  requirePermission('writeTagValues'),
  validateParams(tagIdParamSchema),
  validateBody(writeValueSchema),
  tagValueController.writeValue,
)

router.post(
  '/tags/:id/command',
  requirePermission('sendTagCommands'),
  validateParams(tagIdParamSchema),
  validateBody(writeCommandSchema),
  tagValueController.writeCommand,
)
```

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(telemetry): add REST value write and device command endpoints"
```

---

## Task 10: Counter Calculation

**Goal:** Reset-aware cumulative production calculation for counter tags.

**Spec reference:** Section 9 (Counter Calculation Rules)

**Files:**
- Create: `telemetry/src/modules/historian/calculations/counter.calc.ts`
- Create: `telemetry/src/modules/historian/calculations/counter.calc.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// counter.calc.test.ts
describe('counter calculation', () => {
  it('calculates produced with no reset', () => {
    // Docs: 09:59=100, 10:05=120, 10:10=130, range 10:00-10:10
    // Expected: 130 - 100 = 30
  })

  it('calculates produced with single reset', () => {
    // Docs: 09:59=100, 10:05=120, 10:06=0, 10:10=5, range 10:00-10:10
    // Expected: (5 - 100) + 120 = 25
  })

  it('returns 0 for single doc in range', () => {
    // Only one doc: value=50, prevValue=45 → produced = 50 - 45 = 5
  })

  it('handles multiple resets', () => {
    // 100, 200, 0, 50, 0, 10 → two peaks
  })
})
```

- [ ] **Step 2: Implement counter calculation**

```typescript
// telemetry/src/modules/historian/calculations/counter.calc.ts
import mongoose from 'mongoose'

interface CounterDoc {
  occurredAt: Date
  value: number
  prevValue: number | null
  prev2Value: number | null
  reset: boolean
}

export const calculateProduced = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<number> => {
  const collectionName = `tag_samples_${tagId}`
  const collection = mongoose.connection.db!.collection(collectionName)

  // Get opening baseline: last doc before range start
  const baseline = await collection.findOne<CounterDoc>(
    { occurredAt: { $lte: rangeStart } },
    { sort: { occurredAt: -1 } },
  )

  // Get docs in range
  const docs = await collection
    .find<CounterDoc>({ occurredAt: { $gt: rangeStart, $lte: rangeEnd } })
    .sort({ occurredAt: 1 })
    .toArray()

  if (docs.length === 0) return 0

  const firstDoc = docs[0]
  const lastDoc = docs[docs.length - 1]

  // normal_delta
  let normalDelta: number
  if (docs.length === 1) {
    const openingValue = firstDoc.prevValue ?? baseline?.value ?? 0
    normalDelta = firstDoc.value - openingValue
  } else {
    const openingValue = firstDoc.prevValue ?? baseline?.value ?? 0
    const closingValue = Math.max(lastDoc.value, lastDoc.prevValue ?? lastDoc.value)
    normalDelta = closingValue - openingValue
  }

  // Sum peak values from reset samples
  const peakSum = docs
    .filter(d => d.reset && d.prev2Value != null)
    .reduce((sum, d) => sum + d.prev2Value!, 0)

  return normalDelta + peakSum
}
```

- [ ] **Step 3: Run tests, verify examples from spec match**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(telemetry): add reset-aware counter production calculation"
```

---

## Task 11: Speed Calculation

**Goal:** Stepwise-hold weighted average speed calculation.

**Spec reference:** Section 10 (Speed Calculation Rules)

**Files:**
- Create: `telemetry/src/modules/historian/calculations/speed.calc.ts`
- Create: `telemetry/src/modules/historian/calculations/speed.calc.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe('speed calculation', () => {
  it('calculates weighted avg speed with stepwise-hold', () => {
    // Docs: 10:00:01=120, 10:00:07=90, 10:00:15=80
    // Range: 10:00:03 - 10:00:19
    // Segments: 120×4s + 90×8s + 80×4s = 1520
    // weighted avg = 1520 / 16 = 95
  })

  it('uses last known value before range as initial segment', () => {})

  it('carries last value to range end', () => {})
})
```

- [ ] **Step 2: Implement speed calculation**

```typescript
// telemetry/src/modules/historian/calculations/speed.calc.ts
import mongoose from 'mongoose'

interface SpeedDoc {
  occurredAt: Date
  value: number
}

export const calculateSpeedAvg = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ totalArea: number; weightedAvg: number; durationSec: number }> => {
  const collectionName = `tag_samples_${tagId}`
  const collection = mongoose.connection.db!.collection(collectionName)

  // Get last value before range
  const baseline = await collection.findOne<SpeedDoc>(
    { occurredAt: { $lte: rangeStart } },
    { sort: { occurredAt: -1 } },
  )

  // Get docs in range
  const docs = await collection
    .find<SpeedDoc>({ occurredAt: { $gt: rangeStart, $lte: rangeEnd } })
    .sort({ occurredAt: 1 })
    .toArray()

  // Build segment timeline
  const points: { time: Date; value: number }[] = []

  // Opening point
  if (baseline) {
    points.push({ time: rangeStart, value: baseline.value })
  } else if (docs.length > 0) {
    points.push({ time: rangeStart, value: 0 })
  } else {
    return { totalArea: 0, weightedAvg: 0, durationSec: 0 }
  }

  for (const doc of docs) {
    points.push({ time: doc.occurredAt, value: doc.value })
  }

  // Closing point (carry last value to range end)
  points.push({ time: rangeEnd, value: points[points.length - 1].value })

  // Calculate area
  let totalArea = 0
  for (let i = 0; i < points.length - 1; i++) {
    const durationMs = points[i + 1].time.getTime() - points[i].time.getTime()
    const durationSec = durationMs / 1000
    totalArea += points[i].value * durationSec
  }

  const totalDurationSec = (rangeEnd.getTime() - rangeStart.getTime()) / 1000
  const weightedAvg = totalDurationSec > 0 ? totalArea / totalDurationSec : 0

  return { totalArea, weightedAvg, durationSec: totalDurationSec }
}
```

- [ ] **Step 3: Run tests, verify spec example**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(telemetry): add stepwise-hold speed calculation"
```

---

## Task 12: Binary Queries & Aggregation

**Goal:** State duration queries, rollup endpoints, and remaining historian query routes (compact-values, count, stats).

**Spec reference:** Section 11 (Binary rules), Section 8 (Query Capabilities)

**Files:**
- Create: `telemetry/src/modules/historian/calculations/binary.calc.ts`
- Create: `telemetry/src/modules/historian/historian.service.ts`
- Create: `telemetry/src/modules/historian/historian.controller.ts`
- Create: `telemetry/src/modules/historian/historian.routes.ts`
- Create: `telemetry/src/modules/historian/historian.validators.ts`
- Modify: `telemetry/src/core/loaders/express.ts` (mount historian routes)

- [ ] **Step 1: Implement binary calculation**

```typescript
// telemetry/src/modules/historian/calculations/binary.calc.ts
import mongoose from 'mongoose'

interface BinaryDoc {
  occurredAt: Date
  value: number
}

interface StateSegment {
  state: number
  start: Date
  end: Date
  durationMs: number
}

export const calculateStateDurations = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<StateSegment[]> => {
  const collectionName = `tag_samples_${tagId}`
  const collection = mongoose.connection.db!.collection(collectionName)

  const baseline = await collection.findOne<BinaryDoc>(
    { occurredAt: { $lte: rangeStart } },
    { sort: { occurredAt: -1 } },
  )

  const docs = await collection
    .find<BinaryDoc>({ occurredAt: { $gt: rangeStart, $lte: rangeEnd } })
    .sort({ occurredAt: 1 })
    .toArray()

  const segments: StateSegment[] = []
  let currentState = baseline?.value ?? 0
  let segmentStart = rangeStart

  for (const doc of docs) {
    if (doc.value !== currentState) {
      segments.push({
        state: currentState,
        start: segmentStart,
        end: doc.occurredAt,
        durationMs: doc.occurredAt.getTime() - segmentStart.getTime(),
      })
      currentState = doc.value
      segmentStart = doc.occurredAt
    }
  }

  // Close final segment
  segments.push({
    state: currentState,
    start: segmentStart,
    end: rangeEnd,
    durationMs: rangeEnd.getTime() - segmentStart.getTime(),
  })

  return segments
}
```

- [ ] **Step 2: Implement historian service**

Expose query functions:
- `getCompactValues(tagId, from, to)` — compact timeline `[{ t, v }]`, always prepends previous value before range start
- `getSamples(tagId, from, to, options)` — paginated raw range query, optional `previous` flag
- `getSampleCount(tagId, from, to)` — count of samples in range
- `getStats(tagId, from, to)` — min, max, mean, variance, stddev over range
- `getProduced(tagId, from, to)` — delegates to counter.calc (uses previous value internally)
- `getSpeedAvg(tagId, from, to)` — delegates to speed.calc (uses previous value internally)
- `getStateDurations(tagId, from, to)` — delegates to binary.calc (uses previous value for initial state)
- `getRollup(tagId, from, to, interval, fn)` — bucketed time-series with carry-forward

Previous value behavior per spec Section 8:
- compact-values: always prepend last value before range start
- samples: optional via `?previous=true`
- count, stats: no previous value
- produced, speed-avg, state-durations: use internally, not in response
- rollup: use for carry-forward in empty buckets

- [ ] **Step 3: Implement historian controller, validators, routes**

Routes:
- `GET /historian/:tagId/compact-values` — compact timeline (query: from, to)
- `GET /historian/:tagId/samples` — raw range query (query: from, to, page, limit, previous)
- `GET /historian/:tagId/count` — sample count in range (query: from, to)
- `GET /historian/:tagId/stats` — min, max, mean, variance, stddev (query: from, to)
- `GET /historian/:tagId/produced` — counter calculation (query: from, to)
- `GET /historian/:tagId/speed-avg` — speed calculation (query: from, to)
- `GET /historian/:tagId/state-durations` — binary timeline (query: from, to)
- `GET /historian/:tagId/rollup` — bucketed aggregation (query: from, to, interval, fn)

All require `readHistorian` permission.

- [ ] **Step 4: Write tests for historian service**

- [ ] **Step 5: Mount routes, run tests**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(telemetry): add historian query endpoints with counter, speed, and binary calculations"
```

---

## Task 13: MQTT Discovery

**Goal:** Subscribe to discovery topics, maintain in-memory cache of available nodes per device, expose via API.

**Spec reference:** Section 14 (MQTT Discovery)

**Files:**
- Create: `telemetry/src/modules/discovery/discovery.cache.ts`
- Create: `telemetry/src/modules/discovery/discovery.controller.ts`
- Create: `telemetry/src/modules/discovery/discovery.routes.ts`
- Modify: MQTT message handler (wire discovery topics)

- [ ] **Step 1: Implement discovery cache**

```typescript
// telemetry/src/modules/discovery/discovery.cache.ts

interface NodeInfo {
  nodeId: string
  name: string
  dataType?: string
}

interface DeviceManifest {
  deviceKey: string
  nodes: NodeInfo[]
  receivedAt: Date
}

// deviceKey → manifest
const manifests = new Map<string, DeviceManifest>()

export const discoverySetManifest = (deviceKey: string, nodes: NodeInfo[]): void => {
  manifests.set(deviceKey, { deviceKey, nodes, receivedAt: new Date() })
}

export const discoveryGetAll = () => [...manifests.values()]

export const discoveryGetByDevice = (deviceKey: string) => manifests.get(deviceKey) ?? null
```

- [ ] **Step 2: Wire discovery topics in MQTT handler**

```typescript
// In the MQTT message dispatcher:
if (topic.startsWith('discovery/')) {
  const parts = topic.split('/')
  const deviceKey = parts[1]
  const type = parts[2] // 'manifest' or 'status'

  if (type === 'manifest') {
    try {
      const data = JSON.parse(payload.toString())
      discoverySetManifest(deviceKey, data.nodes ?? [])
    } catch { /* ignore malformed */ }
  } else if (type === 'status') {
    // Persist status to EdgeDevice DB record (not just in-memory)
    const status = payload.toString() // 'online' or 'offline'
    const EdgeDevice = (await import('../edge-device/edge-device.model.js')).default
    await EdgeDevice.findOneAndUpdate({ deviceKey }, { status }).catch(err => {
      logger.warn('EdgeDevice status update failed', {
        event: 'discovery.status.update_failed',
        deviceKey,
        error: err.message,
      })
    })
  }
}
```

- [ ] **Step 3: Create discovery routes**

```typescript
// GET /discovery — list all devices with their nodes
// GET /discovery/:deviceKey — single device manifest
```

Both require `readDiscovery` permission.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(telemetry): add MQTT discovery cache and API endpoints"
```

---

## Task 14: Redis Streams Events

**Goal:** Publish config change events to `events.telemetry` stream. Consume period closure events.

**Spec reference:** Section 17 (Redis Streams Events)

**Files:**
- Create: `telemetry/src/jobs/events.ts`
- Create: `telemetry/src/jobs/subscribers.ts`
- Modify: `telemetry/src/core/loaders/index.ts` (init subscribers)
- Modify: Services (tag-type, edge-device, tag) to emit events

- [ ] **Step 1: Create event publishers**

Follow `user/src/jobs/events.ts` pattern exactly:

```typescript
// telemetry/src/jobs/events.ts
const STREAM = 'events.telemetry'

// Tag events
export const emitTagCreated = (tagId: string) => emit('tag.created', { tagId })
export const emitTagUpdated = (tagId: string) => emit('tag.updated', { tagId })
export const emitTagDeleted = (tagId: string) => emit('tag.deleted', { tagId })

// TagType events
export const emitTagTypeCreated = (tagTypeId: string) => emit('tag_type.created', { tagTypeId })
export const emitTagTypeUpdated = (tagTypeId: string) => emit('tag_type.updated', { tagTypeId })
export const emitTagTypeDeleted = (tagTypeId: string) => emit('tag_type.deleted', { tagTypeId })

// EdgeDevice events
export const emitEdgeDeviceCreated = (edgeDeviceId: string) => emit('edge_device.created', { edgeDeviceId })
export const emitEdgeDeviceUpdated = (edgeDeviceId: string) => emit('edge_device.updated', { edgeDeviceId })
export const emitEdgeDeviceDeleted = (edgeDeviceId: string) => emit('edge_device.deleted', { edgeDeviceId })
```

- [ ] **Step 2: Create subscribers**

Follow `user/src/jobs/subscribers.ts` pattern. Register a placeholder handler for period closure events. The stream name and event type will be defined when the production/period service is built. For now, the consumer setup is ready to receive these events.

Period closure enforcement: When a period closure event arrives, the handler stores the lock timestamp in an in-memory variable (e.g., `let periodLockBefore: Date | null`). The ingestion pipeline checks this before writing: if `sample.time <= periodLockBefore`, the write is rejected. This is checked in both MQTT and REST value write paths.

```typescript
let periodLockBefore: Date | null = null

export const getPeriodLock = () => periodLockBefore

const consumer = createStreamConsumer({
  redis: streamClient,
  group: 'telemetry-service',
  consumer: `telemetry-${process.pid}`,
  streams: {
    // Period closure events (stream name TBD — will be events.production or similar)
    // 'events.production': {
    //   'period.closed': ({ lockedBefore }) => { periodLockBefore = new Date(lockedBefore) },
    // },
  },
  logger,
  runInContext: (traceId, fn) => runInContext({ traceId, ip: 'internal' }, fn),
})
```

- [ ] **Step 3: Add emit calls to services**

Add event emission to tag-type.service.ts, edge-device.service.ts, and tag.service.ts — after each create/update/delete.

- [ ] **Step 4: Init subscribers in loader**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(telemetry): add Redis Streams event publishing and consumer setup"
```

---

## Spec Coverage Check

| Spec Section | Task |
|---|---|
| 1. Service Purpose | All tasks |
| 2. Core Domain Concepts | Tasks 3-5 (models), Task 7 (caches), Task 13 (discovery) |
| 3. Supported Tag Behaviors | Task 5 (tag model enum) |
| 4. Storage Model | Task 8 (per-tag collections, current_states) |
| 5. Tag Definition Fields | Task 5 (tag model) |
| 6. Historian Sample Schema | Task 8 (historian repository) |
| 7. Ingestion Rules | Tasks 7-8 (caches, pipeline) |
| 8. Query Capabilities | Task 12 (historian service — compact-values, samples, count, stats, produced, speed-avg, state-durations, rollup + previous value behavior) |
| 9. Counter Calculation | Task 10 |
| 10. Speed Calculation | Task 11 |
| 11. Binary Calculation | Task 12 |
| 12. Historian Integrity | Task 5 (behavior immutability), Task 8 (per-tag isolation), Task 14 (period closure enforcement in ingestion) |
| 13. Retention and Export | Task 5 (retentionPolicy field — actual cleanup is v2) |
| 14. EdgeDevice & Node Management | Task 4, Task 5 (binding), Task 13 (discovery) |
| 15. MQTT Telemetry Contract | Task 6 (MQTT client) |
| 16. Tag Value Write Paths | Task 9 |
| 17. Redis Streams Events | Task 14 |
| 17. Realtime Pub/Sub | Task 8 (publishRealtimeValue in pipeline) |
| 17. Socket.io Delivery | Out of scope (realtime service responsibility) |
| 18. Audit Fields | Tasks 3-5 (timestamps + auditLogPlugin) |
| 19. Non-Functional | Tasks 8, 10-12 (stream approach, deterministic calcs) |
| 20. Edge Tool: Node-RED | Task 9 (HTTP write), Task 13 (discovery) |
| 21. Local Dev/Test Setup | Task 2 (docker-compose + MQTT test script) — OPC-UA simulator deferred |
| 22. v2+ Notes | Excluded from plan (as specified) |
