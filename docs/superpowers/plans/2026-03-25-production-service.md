# Production Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `production-service` owning Uom, ProductCategory, Product, ProductStandard, ProductionPlan, JobOrder, QuantityAdjustment, and ScrapEntry.

**Architecture:** Express 5 + Mongoose 9 + Zod 4 microservice following `work-center/` conventions exactly. Module-per-entity (8 modules), shared pagination, audit logging, event publishing via Redis Streams (`events.production`), internal API for cross-service contracts.

**Tech Stack:** TypeScript 5.5+, Express 5, Mongoose 9, Zod 4, ioredis 5, Vitest, testcontainers

**Spec:** `docs/production-service-spec.md`
**Reference service:** `work-center/` — all infrastructure and patterns derived from here.

---

## Prerequisites

- [ ] `@mes/auth` workCenterIds cache (spec Cross-Cutting Rules) — separate task, blocks visibility optimization but NOT this plan. This plan uses the existing `resolveVisibility` pattern (internal API call) as fallback.

## File Structure

```
production/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── Dockerfile
├── locales/
│   ├── en/translation.json
│   └── tr/translation.json
├── src/
│   ├── app.ts
│   ├── config/index.ts
│   ├── constants/
│   │   ├── privileges.ts
│   │   └── identity.ts
│   ├── core/
│   │   ├── loaders/
│   │   │   ├── express.ts
│   │   │   ├── mongoose.ts
│   │   │   ├── i18n.ts
│   │   │   └── index.ts
│   │   ├── middleware/
│   │   │   ├── error-handler.ts
│   │   │   ├── request-context.ts
│   │   │   └── validate.ts
│   │   └── types/
│   │       ├── api.types.ts
│   │       └── express.d.ts
│   ├── lib/
│   │   ├── logger.ts
│   │   ├── redis.ts
│   │   ├── cache.ts
│   │   ├── shutdown.ts
│   │   ├── internal-api.ts
│   │   └── plugins/
│   │       ├── audit-log.plugin.ts
│   │       └── audit-log.model.ts
│   ├── modules/
│   │   ├── uom/                         (5 files: model, validators, service, controller, routes)
│   │   ├── product-category/            (5 files)
│   │   ├── product/                     (5 files)
│   │   ├── product-standard/            (5 files)
│   │   ├── production-plan/             (5 files)
│   │   ├── job-order/                   (5 files)
│   │   ├── quantity-adjustment/         (5 files)
│   │   └── scrap-entry/                 (5 files)
│   ├── jobs/
│   │   ├── events.ts
│   │   └── subscribers.ts
│   ├── utils/
│   │   ├── pagination.ts
│   │   ├── validators.ts
│   │   └── db.ts
│   └── test/
│       └── setup.ts
```

---

## Module Pattern Reference

Every entity follows this 5-file pattern. Per-entity tasks only document **differences** from this reference. Read `work-center/src/modules/operators/` for a live example.

### Model (`entity.model.ts`)

```typescript
import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

const entitySchema = new Schema(
  {
    // ... entity-specific fields ...
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: true },
)

entitySchema.index({ /* entity-specific indexes */ })

const transform = (_doc: unknown, ret: Record<string, unknown>) => {
  delete ret.__v
  return ret
}
entitySchema.set('toObject', { virtuals: true, transform })
entitySchema.set('toJSON', { virtuals: true, transform })

export type IEntity = InferSchemaType<typeof entitySchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

entitySchema.plugin(auditLogPlugin)
export const Entity = model<IEntity>('Entity', entitySchema)
```

### Validators (`entity.validators.ts`)

```typescript
import { z } from 'zod'
import { objectIdSchema } from '../../utils/validators.js'
import { paginationSchema } from '../../utils/pagination.js'

export const createEntitySchema = z.object({ /* required + optional fields */ })

export const patchEntitySchema = z.object({ /* all optional */ })
  .refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const entityIdParamSchema = z.object({ id: objectIdSchema })

export const entityListSchema = paginationSchema.extend({ /* filter fields */ })

export type CreateEntityInput = z.infer<typeof createEntitySchema>
export type PatchEntityInput = z.infer<typeof patchEntitySchema>
export type EntityListInput = z.infer<typeof entityListSchema>
```

### Service (`entity.service.ts`)

```typescript
import { CustomError } from '@mes/core'
import { paginate, type PaginatedResult } from '../../utils/pagination.js'
import { emitEntityCreated, emitEntityUpdated, emitEntityDeleted } from '../../jobs/events.js'
import { Entity, type IEntity } from './entity.model.js'
import type { CreateEntityInput, PatchEntityInput, EntityListInput } from './entity.validators.js'

export async function create(data: CreateEntityInput, userId: string): Promise<IEntity> {
  const doc = await Entity.create({ ...data, createdBy: userId, updatedBy: userId })
  emitEntityCreated(doc._id.toString())
  return doc
}

export async function getById(id: string): Promise<IEntity> {
  const doc = await Entity.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IEntity
}

export async function list(input: EntityListInput): Promise<PaginatedResult<IEntity>> {
  const { page, limit, sort, search, ...filters } = input
  const query: Record<string, unknown> = {}
  // Map non-undefined filters to query
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }
  return paginate(Entity, query, { page, limit, sort, search }, {
    allowedSortFields: [/* entity-specific */],
    searchFields: [/* entity-specific */],
  })
}

export async function update(id: string, data: PatchEntityInput, userId: string): Promise<IEntity> {
  const doc = await Entity.findOneAndUpdate(
    { _id: id },
    { $set: { ...data, updatedBy: userId } },
    { new: true, runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitEntityUpdated(doc._id.toString())
  return doc
}

export async function remove(id: string): Promise<IEntity> {
  // Reference checks before delete
  const doc = await Entity.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitEntityDeleted(doc._id.toString())
  return doc
}
```

### Controller (`entity.controller.ts`)

**Permission-only entities** (Uom, ProductCategory, Product, ProductionPlan):

```typescript
import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { PaginatedResult } from '../../utils/pagination.js'
import type { IEntity } from './entity.model.js'
import * as service from './entity.service.js'

export const create = async (req: Request, res: Response<SuccessResponse<IEntity>>) => {
  const doc = await service.create(req.body, req.user!.id)
  res.status(201).json({ message: req.t('success.create'), data: doc })
}
export const getById = async (req: Request<{ id: string }>, res: Response) => {
  const doc = await service.getById(req.params.id)
  res.json({ data: doc })
}
export const list = async (req: Request, res: Response) => {
  const result = await service.list(req.query as any)
  res.json(result)
}
export const update = async (req: Request<{ id: string }>, res: Response) => {
  const doc = await service.update(req.params.id, req.body, req.user!.id)
  res.json({ message: req.t('success.update'), data: doc })
}
export const remove = async (req: Request<{ id: string }>, res: Response) => {
  const doc = await service.remove(req.params.id)
  res.json({ message: req.t('success.delete'), data: doc })
}
```

**Work-center-bound entities** (ProductStandard, JobOrder, QA, ScrapEntry) add visibility:

```typescript
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { getUserWorkCenterIds } from '../../lib/internal-api.js'

async function resolveVisibility(userId: string): Promise<string[] | undefined> {
  if (userId === SYSTEM_IDENTITY) return undefined
  const ids = await getUserWorkCenterIds(userId)
  return ids ?? []
}

// list/getById pass visibleIds to service for filtering
// create/update/delete/start/end check workCenterId ∈ visibleIds
```

### Routes (`entity.routes.ts`)

```typescript
import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as ctrl from './entity.controller.js'
import { createSchema, patchSchema, idParamSchema, listSchema } from './entity.validators.js'

const router = Router()
router.post('/entities', requirePermission('writeX'), validateBody(createSchema), ctrl.create)
router.get('/entities', requirePermission('readX'), validateQuery(listSchema), ctrl.list)
router.get('/entities/:id', requirePermission('readX'), validateParams(idParamSchema), ctrl.getById)
router.patch('/entities/:id', requirePermission('writeX'), validateParams(idParamSchema), validateBody(patchSchema), ctrl.update)
router.delete('/entities/:id', requirePermission('deleteX'), validateParams(idParamSchema), ctrl.remove)
export default router
```

### Test Pattern

```typescript
import { describe, it, expect } from 'vitest'
import { Entity } from './entity.model.js'

describe('EntityService', () => {
  it('creates entity with valid data', async () => { /* ... */ })
  it('rejects duplicate code', async () => { /* ... */ })
  it('returns paginated list', async () => { /* ... */ })
  it('updates entity fields', async () => { /* ... */ })
  it('blocks delete when referenced', async () => { /* ... */ })
})
```

---

## Phase 1: Service Scaffold

### Task 1: Initialize production workspace

**Files:**
- Create: `production/package.json`
- Create: `production/tsconfig.json`
- Create: `production/vitest.config.ts`
- Create: `production/.env.example`
- Modify: `pnpm-workspace.yaml` — add `production`
- Modify: `tsconfig.json` (root) — NOT modified (root only references packages, not apps)

- [ ] **Step 1: Create `production/package.json`**

```json
{
  "name": "production-service",
  "version": "1.0.0",
  "description": "Production microservice for MES",
  "author": "Ulas Deniz Isik",
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "start": "node dist/app.js",
    "dev": "tsx watch src/app.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "@faker-js/faker": "^10.3.0",
    "@testcontainers/mongodb": "^11.12.0",
    "@types/compression": "^1.8.1",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/morgan": "^1.9.10",
    "@types/node": "^25.3.5",
    "@types/supertest": "^7.2.0",
    "@types/swagger-ui-express": "^4.1.8",
    "@vitest/coverage-v8": "^4.0.18",
    "jiti": "^2.6.1",
    "mongodb-memory-server": "^11.0.1",
    "swagger-ui-express": "^5.0.1",
    "supertest": "^7.2.2",
    "testcontainers": "^11.12.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "@mes/testing": "workspace:*",
    "vitest": "^4.0.18"
  },
  "dependencies": {
    "@mes/auth": "workspace:*",
    "@mes/cache": "workspace:*",
    "@mes/core": "workspace:*",
    "@mes/logger": "workspace:*",
    "@mes/events": "workspace:*",
    "@mes/health": "workspace:*",
    "@mes/openapi": "workspace:*",
    "compression": "^1.8.1",
    "cors": "^2.8.6",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "helmet": "^8.1.0",
    "i18next": "^25.8.14",
    "i18next-fs-backend": "^2.6.1",
    "i18next-http-middleware": "^3.9.2",
    "ioredis": "^5.10.0",
    "mongoose": "^9.2.4",
    "morgan": "^1.10.1",
    "uuid": "^13.0.0",
    "winston": "^3.19.0",
    "winston-daily-rotate-file": "^5.0.0",
    "zod": "^4.3.6",
    "zod-openapi": "^5.4.6"
  },
  "type": "module"
}
```

- [ ] **Step 2: Create `production/tsconfig.json`**

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

- [ ] **Step 3: Create `production/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['src/test/contracts/**'],
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'test_secret',
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_API_USER: 'http://localhost:3000',
      INTERNAL_API_WORK_CENTER: 'http://localhost:3001',
    },
  },
})
```

- [ ] **Step 4: Create `production/.env.example`**

```
NODE_ENV=development
PORT=3002
MONGO_URI=mongodb://localhost:27017/mes?directConnection=true
REDIS_URL=redis://localhost:6379
JWT_SECRET=supersecretkey
LOG_LEVEL=debug
INTERNAL_API_USER=http://localhost:3000
INTERNAL_API_WORK_CENTER=http://localhost:3001
MONGO_INDEX_STRATEGY=ensure
```

- [ ] **Step 5: Add to `pnpm-workspace.yaml`**

Add `- 'production'` to the packages array.

- [ ] **Step 6: Install dependencies**

Run: `cd production && pnpm install`

- [ ] **Step 7: Commit**

```bash
git add production/package.json production/tsconfig.json production/vitest.config.ts production/.env.example pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build: scaffold production-service workspace"
```

---

### Task 2: Core infrastructure files

**Files:** Copy from `work-center/src/` and adapt. All files listed below.

- [ ] **Step 1: Create config and constants**

`production/src/config/index.ts` — copy from `work-center/src/config/index.ts`, change:
- `PORT` default: `3002`
- Add `INTERNAL_API_WORK_CENTER` env var (same pattern as `INTERNAL_API_USER`)

`production/src/constants/identity.ts` — identical to work-center.

`production/src/constants/privileges.ts`:

```typescript
export const PRIVILEGES = [
  // Catalog
  'readCatalog',
  'writeCatalog',
  'deleteCatalog',
  // ProductStandard
  'readProductStandards',
  'writeProductStandards',
  'deleteProductStandards',
  // ProductionPlan
  'readProductionPlans',
  'writeProductionPlans',
  'deleteProductionPlans',
  // JobOrder
  'readJobOrders',
  'writeJobOrders',
  'deleteJobOrders',
  'executeJobOrders',
  // Adjustments
  'readProductionAdjustments',
  'writeProductionAdjustments',
  'deleteProductionAdjustments',
] as const
```

- [ ] **Step 2: Create core/loaders, middleware, types**

Copy these files verbatim from `work-center/src/`:
- `core/middleware/error-handler.ts`
- `core/middleware/request-context.ts`
- `core/middleware/validate.ts`
- `core/types/api.types.ts`
- `core/types/express.d.ts`
- `core/loaders/i18n.ts`

`core/loaders/index.ts` — copy from work-center, no changes needed.

`core/loaders/mongoose.ts` — copy from work-center, change model imports:

```typescript
// Register models
import '../../modules/uom/uom.model.js'
import '../../modules/product-category/product-category.model.js'
import '../../modules/product/product.model.js'
import '../../modules/product-standard/product-standard.model.js'
import '../../modules/production-plan/production-plan.model.js'
import '../../modules/job-order/job-order.model.js'
import '../../modules/quantity-adjustment/quantity-adjustment.model.js'
import '../../modules/scrap-entry/scrap-entry.model.js'
```

`core/loaders/express.ts` — copy from work-center, change `mountSharedRoutes`:

```typescript
import uomRoutes from '../../modules/uom/uom.routes.js'
import productCategoryRoutes from '../../modules/product-category/product-category.routes.js'
import productRoutes from '../../modules/product/product.routes.js'
import productStandardRoutes from '../../modules/product-standard/product-standard.routes.js'
import productionPlanRoutes from '../../modules/production-plan/production-plan.routes.js'
import jobOrderRoutes from '../../modules/job-order/job-order.routes.js'
import quantityAdjustmentRoutes from '../../modules/quantity-adjustment/quantity-adjustment.routes.js'
import scrapEntryRoutes from '../../modules/scrap-entry/scrap-entry.routes.js'
import { workCenterReferencesInternalRoutes } from '../../modules/job-order/job-order.routes.js'

const mountSharedRoutes = (router: ReturnType<typeof Router>) => {
  router.use(uomRoutes)
  router.use(productCategoryRoutes)
  router.use(productRoutes)
  router.use(productStandardRoutes)
  router.use(productionPlanRoutes)
  router.use(jobOrderRoutes)
  router.use(quantityAdjustmentRoutes)
  router.use(scrapEntryRoutes)
}

// Internal routes — mounted separately on internalRouter in initExpress(), NOT inside mountSharedRoutes:
// internalRouter.use(workCenterReferencesInternalRoutes)
```

- [ ] **Step 3: Create lib files**

Copy verbatim from `work-center/src/lib/`:
- `logger.ts` — identical
- `shutdown.ts` — identical
- `plugins/audit-log.plugin.ts` — identical
- `plugins/audit-log.model.ts` — identical
- `cache.ts` — identical

`lib/redis.ts` — copy from work-center, change keyPrefix:

```typescript
export const redisClient = new Redis(REDIS_URL, {
  ...baseOptions,
  keyPrefix: 'prod:',  // was 'wc:'
})
```

`lib/internal-api.ts`:

```typescript
import { config } from '../config/index.js'
import { logger } from './logger.js'

const USER_API = config.INTERNAL_API_USER
const WC_API = config.INTERNAL_API_WORK_CENTER

async function fetchInternal(baseUrl: string, path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
}

// ── User service calls ──────────────────────────────────────────────────────

export async function getUserWorkCenterIds(userId: string): Promise<string[] | null> {
  try {
    const res = await fetchInternal(USER_API, `/users/${userId}`)
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { workCenterIds?: string[] } }
    return body.data?.workCenterIds?.map(String) ?? []
  } catch {
    logger.warn('User-service unreachable for visibility check', {
      event: 'internal_api.user.unreachable',
      userId,
    })
    return null
  }
}

// ── Work center service calls ───────────────────────────────────────────────

interface WorkCenterInfo {
  type: 'physical' | 'virtual'
  productivityMode?: 'count_based' | 'speed_based'
}

export async function getWorkCenterInfo(workCenterId: string): Promise<WorkCenterInfo | null> {
  try {
    const res = await fetchInternal(WC_API, `/work-centers/${workCenterId}`)
    if (!res.ok) return null
    const body = (await res.json()) as { data?: WorkCenterInfo }
    return body.data ?? null
  } catch {
    logger.warn('Work-center-service unreachable', {
      event: 'internal_api.work_center.unreachable',
      workCenterId,
    })
    return null
  }
}
```

- [ ] **Step 4: Create utils and test setup**

Copy verbatim from `work-center/src/`:
- `utils/pagination.ts`
- `utils/validators.ts`
- `utils/db.ts`
- `test/setup.ts`

- [ ] **Step 5: Create `app.ts`**

Copy from `work-center/src/app.ts` — identical structure, no changes needed.

- [ ] **Step 6: Create `jobs/events.ts`**

```typescript
import { getTraceId } from '@mes/core'
import { publishEvent } from '@mes/events'
import { logger } from '../lib/logger.js'
import { streamClient } from '../lib/redis.js'

const STREAM = 'events.production'

async function emit(type: string, data: Record<string, unknown>): Promise<void> {
  try {
    await publishEvent(streamClient, STREAM, type, { ...data, traceId: getTraceId() })
  } catch (err) {
    logger.warn(`Failed to publish event ${type}`, {
      event: 'events.publish.failed',
      eventType: type,
      error: err instanceof Error ? err.message : err,
    })
  }
}

// ── Catalog ─────────────────────────────────────────────────────────────────
export const emitUomCreated = (uomId: string) => emit('uom.created', { uomId })
export const emitUomUpdated = (uomId: string) => emit('uom.updated', { uomId })
export const emitUomDeleted = (uomId: string) => emit('uom.deleted', { uomId })

export const emitProductCategoryCreated = (categoryId: string) => emit('product_category.created', { categoryId })
export const emitProductCategoryUpdated = (categoryId: string) => emit('product_category.updated', { categoryId })
export const emitProductCategoryDeleted = (categoryId: string) => emit('product_category.deleted', { categoryId })

export const emitProductCreated = (productId: string) => emit('product.created', { productId })
export const emitProductUpdated = (productId: string) => emit('product.updated', { productId })
export const emitProductDeleted = (productId: string) => emit('product.deleted', { productId })

// ── Standards ───────────────────────────────────────────────────────────────
export const emitProductStandardCreated = (standardId: string) => emit('product_standard.created', { standardId })
export const emitProductStandardUpdated = (standardId: string) => emit('product_standard.updated', { standardId })
export const emitProductStandardDeleted = (standardId: string) => emit('product_standard.deleted', { standardId })

// ── Plans ───────────────────────────────────────────────────────────────────
export const emitProductionPlanCreated = (planId: string) => emit('production_plan.created', { planId })
export const emitProductionPlanUpdated = (planId: string) => emit('production_plan.updated', { planId })
export const emitProductionPlanDeleted = (planId: string) => emit('production_plan.deleted', { planId })

// ── Job Orders ──────────────────────────────────────────────────────────────
export const emitJobOrderCreated = (jobOrderId: string) => emit('job_order.created', { jobOrderId })
export const emitJobOrderUpdated = (jobOrderId: string) => emit('job_order.updated', { jobOrderId })
export const emitJobOrderStarted = (jobOrderId: string, workCenterId: string) =>
  emit('job_order.started', { jobOrderId, workCenterId })
export const emitJobOrderEnded = (jobOrderId: string, workCenterId: string) =>
  emit('job_order.ended', { jobOrderId, workCenterId })
export const emitJobOrderDeleted = (jobOrderId: string) => emit('job_order.deleted', { jobOrderId })

// ── Adjustments ─────────────────────────────────────────────────────────────
export const emitQuantityAdjustmentCreated = (adjustmentId: string) => emit('quantity_adjustment.created', { adjustmentId })
export const emitQuantityAdjustmentUpdated = (adjustmentId: string) => emit('quantity_adjustment.updated', { adjustmentId })
export const emitQuantityAdjustmentDeleted = (adjustmentId: string) => emit('quantity_adjustment.deleted', { adjustmentId })

export const emitScrapEntryCreated = (scrapEntryId: string) => emit('scrap_entry.created', { scrapEntryId })
export const emitScrapEntryUpdated = (scrapEntryId: string) => emit('scrap_entry.updated', { scrapEntryId })
export const emitScrapEntryDeleted = (scrapEntryId: string) => emit('scrap_entry.deleted', { scrapEntryId })
```

- [ ] **Step 7: Create `jobs/subscribers.ts`**

```typescript
import { logger } from '../lib/logger.js'

// Production-service does not consume events from other services.
// This file exists for the shutdown hook interface.

export async function initSubscribers(): Promise<void> {
  logger.debug('No event subscribers to initialize', { event: 'subscribers.init.skip' })
}

export async function shutdownSubscribers(): Promise<void> {
  logger.debug('No event subscribers to shut down', { event: 'subscribers.shutdown.skip' })
}
```

- [ ] **Step 8: Create locale files**

`production/locales/en/translation.json`:
```json
{
  "success": {
    "create": "Created successfully",
    "update": "Updated successfully",
    "delete": "Deleted successfully",
    "started": "Job order started successfully",
    "ended": "Job order ended successfully"
  },
  "error": {
    "not_found": "Resource not found",
    "empty_patch": "At least one field must be provided",
    "duplicate_code": "Code already exists",
    "referenced": "Cannot delete: resource is referenced by other records",
    "work_center_not_physical": "Work center must be physical",
    "work_center_unreachable": "Work center service is unreachable",
    "counter_multiplier_required": "Counter multiplier is required for count-based work centers",
    "ideal_speed_required": "Ideal speed is required for speed-based work centers",
    "must_be_positive": "Value must be a positive number",
    "product_standard_applied": "Applied product standard cannot be modified or deleted",
    "product_standard_last_revision": "Cannot delete the last product standard for this product-work center combination while job orders exist",
    "plan_target_exceeded": "Sum of child job order targets would exceed production plan target",
    "plan_product_mismatch": "Job order product must match production plan product",
    "plan_immutable_field": "Field cannot be changed after child job orders exist",
    "job_order_no_standard": "No applicable product standard found for this product-work center combination",
    "job_order_already_started": "Job order has already been started",
    "job_order_not_started": "Job order has not been started",
    "job_order_already_ended": "Job order has already been ended",
    "job_order_overlap": "Execution interval overlaps with another job order on this work center",
    "job_order_active_exists": "Another job order is active on this work center",
    "job_order_start_future": "Start time cannot be in the future",
    "job_order_end_future": "End time cannot be in the future",
    "job_order_end_before_start": "End time cannot be before start time",
    "job_order_time_before_start": "Time cannot be before job order start time",
    "job_order_not_started_for_adjustment": "Job order must be started before creating adjustments",
    "amount_zero": "Amount cannot be zero",
    "scrap_end_before_start": "End time must be after start time",
    "immutable_field": "This field cannot be changed"
  }
}
```

`production/locales/tr/translation.json`:
```json
{
  "success": {
    "create": "Başarıyla oluşturuldu",
    "update": "Başarıyla güncellendi",
    "delete": "Başarıyla silindi",
    "started": "İş emri başarıyla başlatıldı",
    "ended": "İş emri başarıyla sonlandırıldı"
  },
  "error": {
    "not_found": "Kaynak bulunamadı",
    "empty_patch": "En az bir alan sağlanmalıdır",
    "duplicate_code": "Kod zaten mevcut",
    "referenced": "Silinemez: kaynak başka kayıtlar tarafından referans ediliyor",
    "work_center_not_physical": "İş merkezi fiziksel olmalıdır",
    "work_center_unreachable": "İş merkezi servisi erişilemez durumda",
    "counter_multiplier_required": "Sayaç çarpanı sayım tabanlı iş merkezleri için zorunludur",
    "ideal_speed_required": "İdeal hız hız tabanlı iş merkezleri için zorunludur",
    "must_be_positive": "Değer pozitif bir sayı olmalıdır",
    "product_standard_applied": "Uygulanmış ürün standardı değiştirilemez veya silinemez",
    "product_standard_last_revision": "İş emirleri mevcutken bu ürün-iş merkezi kombinasyonu için son ürün standardı silinemez",
    "plan_target_exceeded": "Alt iş emri hedefleri toplamı üretim planı hedefini aşar",
    "plan_product_mismatch": "İş emri ürünü üretim planı ürünüyle eşleşmelidir",
    "plan_immutable_field": "Alt iş emirleri oluştuktan sonra bu alan değiştirilemez",
    "job_order_no_standard": "Bu ürün-iş merkezi kombinasyonu için uygun ürün standardı bulunamadı",
    "job_order_already_started": "İş emri zaten başlatılmış",
    "job_order_not_started": "İş emri henüz başlatılmamış",
    "job_order_already_ended": "İş emri zaten sonlandırılmış",
    "job_order_overlap": "Çalışma aralığı bu iş merkezindeki başka bir iş emriyle çakışıyor",
    "job_order_active_exists": "Bu iş merkezinde başka bir aktif iş emri var",
    "job_order_start_future": "Başlangıç zamanı gelecekte olamaz",
    "job_order_end_future": "Bitiş zamanı gelecekte olamaz",
    "job_order_end_before_start": "Bitiş zamanı başlangıç zamanından önce olamaz",
    "job_order_time_before_start": "Zaman iş emri başlangıç zamanından önce olamaz",
    "job_order_not_started_for_adjustment": "Düzeltme oluşturmadan önce iş emri başlatılmış olmalıdır",
    "amount_zero": "Miktar sıfır olamaz",
    "scrap_end_before_start": "Bitiş zamanı başlangıç zamanından sonra olmalıdır",
    "immutable_field": "Bu alan değiştirilemez"
  }
}
```

- [ ] **Step 9: Verify build**

Run: `cd production && pnpm build`
Expected: Successful TypeScript compilation (will fail until modules exist — that's OK, note which imports are missing and stub them)

- [ ] **Step 10: Commit**

```bash
git add production/src/ production/locales/
git commit -m "build: add production-service core infrastructure"
```

---

## Phase 2: Catalog Module (Uom, ProductCategory, Product)

### Task 3: Uom module (pattern template)

**Files:**
- Create: `production/src/modules/uom/uom.model.ts`
- Create: `production/src/modules/uom/uom.validators.ts`
- Create: `production/src/modules/uom/uom.service.ts`
- Create: `production/src/modules/uom/uom.controller.ts`
- Create: `production/src/modules/uom/uom.routes.ts`

This is the simplest entity — no refs, no work-center binding. It establishes the pattern all other entities follow.

- [ ] **Step 1: Write Uom model**

Schema fields:
```typescript
code: { type: String, required: true, unique: true, trim: true }
name: { type: String, required: true, trim: true }
symbol: { type: String, required: true, trim: true }
```
No `createdBy`/`updatedBy` — Uom is a simple reference table (no actor tracking, audit plugin handles history). **Service deviation from Module Pattern:** `create()` omits `createdBy`/`updatedBy` fields, `update()` omits `updatedBy`. Same applies to ProductCategory.

- [ ] **Step 2: Write Uom validators**

```typescript
const codeSchema = z.string().trim().min(1).max(50)
const nameSchema = z.string().trim().min(1).max(100)
const symbolSchema = z.string().trim().min(1).max(20)

export const createUomSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  symbol: symbolSchema,
})

export const patchUomSchema = z.object({
  code: codeSchema.optional(),
  name: nameSchema.optional(),
  symbol: symbolSchema.optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'error.empty_patch' })

export const uomIdParamSchema = z.object({ id: objectIdSchema })

export const uomListSchema = paginationSchema.extend({
  code: z.string().optional(),
  name: z.string().optional(),
  symbol: z.string().optional(),
})
```

- [ ] **Step 3: Write Uom service**

Follow Module Pattern. Delete check:
```typescript
export async function remove(id: string): Promise<IUom> {
  // Block if any Product references this Uom
  const productCount = await Product.countDocuments({ uomId: id })
  if (productCount > 0) throw new CustomError(409, 'error.referenced')

  const doc = await Uom.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitUomDeleted(doc._id.toString())
  return doc
}
```

Pagination options:
```typescript
allowedSortFields: ['code', 'name', 'symbol', 'createdAt', 'updatedAt']
searchFields: ['code', 'name', 'symbol']
```

- [ ] **Step 4: Write Uom controller and routes**

Follow Module Pattern — permission-only controller (no visibility). Routes use `readCatalog`, `writeCatalog`, `deleteCatalog`. Path: `/uoms`.

- [ ] **Step 5: Write Uom tests**

File: `production/src/modules/uom/uom.service.test.ts`

Key test cases:
- Creates Uom with valid data
- Rejects duplicate code
- Returns paginated list with sort and search
- Updates fields via patch
- Blocks delete when Product references exist
- Allows delete when no references

- [ ] **Step 6: Run tests**

Run: `cd production && pnpm test`

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: add uom module with CRUD and reference checks"
```

---

### Task 4: ProductCategory module

Follows Uom pattern exactly. Differences only:

**Schema:** `code` (unique), `name`, `description` (optional, default null)

**Delete check:** Block if any `Product.categoryId` references it.

**List filters:** `code`, `name`. Search: `code`, `name`. Sort: `code`, `name`, `createdAt`, `updatedAt`.

**Routes path:** `/product-categories`. Permissions: `readCatalog`, `writeCatalog`, `deleteCatalog`.

- [ ] **Step 1:** Write model, validators, service, controller, routes
- [ ] **Step 2:** Write tests (same cases as Uom + description null handling)
- [ ] **Step 3:** Run tests
- [ ] **Step 4:** Commit: `feat: add product-category module`

---

### Task 5: Product module

More complex than Uom — has references and `kind` enum.

**Schema fields:**
```typescript
code: { type: String, required: true, unique: true, trim: true }
name: { type: String, required: true, trim: true }
description: { type: String, default: null }
categoryId: { type: Schema.Types.ObjectId, ref: 'ProductCategory', default: null }
kind: { type: String, required: true, enum: ['finished', 'semi_finished'] }
uomId: { type: Schema.Types.ObjectId, ref: 'Uom', required: true }
props: { type: Map, of: String, default: () => new Map() }
```

**Service create/update validations:**
- `uomId` → verify Uom exists: `Uom.findById(data.uomId)` or throw 404
- `categoryId` → if provided, verify ProductCategory exists or throw 404

**Delete check:** Block if referenced by `ProductStandard`, `ProductionPlan`, `JobOrder`, `QuantityAdjustment`, or `ScrapEntry`.

**Patch:** `props` replaces entire object on patch (not merge).

**List filters:** `_id`, `code`, `kind`, `categoryId`, `uomId`. Search: `code`, `name`. Sort: `code`, `name`, `kind`, `createdAt`, `updatedAt`.

**Routes path:** `/products`. Permissions: `readCatalog`, `writeCatalog`, `deleteCatalog`.

- [ ] **Step 1:** Write model (with ref fields and props Map)
- [ ] **Step 2:** Write validators (kind enum, objectId refs)
- [ ] **Step 3:** Write service (ref validation on create/update, multi-collection delete check)
- [ ] **Step 4:** Write controller and routes
- [ ] **Step 5:** Write tests (ref validation, kind filtering, props replacement, delete blocks)
- [ ] **Step 6:** Run tests
- [ ] **Step 7:** Commit: `feat: add product module with reference validation`

---

## Phase 3: Standards

### Task 6: ProductStandard module

**Work-center-bound** entity with complex applied/immutable rules.

**Schema fields:**
```typescript
productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true }
workCenterId: { type: Schema.Types.ObjectId, required: true, index: true } // cross-service ref, no local model
validFrom: { type: Date, required: true }
idealOutputPerMinute: { type: Number, required: true }
counterMultiplier: { type: Number, default: null }
idealSpeed: { type: Number, default: null }
createdBy: { type: Schema.Types.ObjectId, required: true }
updatedBy: { type: Schema.Types.ObjectId, default: null }
```

**Indexes:** `{ productId: 1, workCenterId: 1, validFrom: 1 }` unique compound.

**Service — key business logic:**

```typescript
// Create validation
async function validateCreateStandard(data: CreateInput): Promise<void> {
  // 1. Product must exist
  const product = await Product.findById(data.productId)
  if (!product) throw new CustomError(404, 'error.not_found')

  // 2. WorkCenter must exist and be physical
  const wcInfo = await getWorkCenterInfo(data.workCenterId)
  if (!wcInfo) throw new CustomError(400, 'error.work_center_unreachable')
  if (wcInfo.type !== 'physical') throw new CustomError(400, 'error.work_center_not_physical')

  // 3. Productivity mode validation
  if (wcInfo.productivityMode === 'count_based' && !data.counterMultiplier) {
    throw new CustomError(400, 'error.counter_multiplier_required')
  }
  if (wcInfo.productivityMode === 'speed_based' && !data.idealSpeed) {
    throw new CustomError(400, 'error.ideal_speed_required')
  }

  // 4. Positive number checks
  if (data.idealOutputPerMinute <= 0) throw new CustomError(400, 'error.must_be_positive')
  if (data.counterMultiplier !== undefined && data.counterMultiplier !== null && data.counterMultiplier <= 0)
    throw new CustomError(400, 'error.must_be_positive')
  if (data.idealSpeed !== undefined && data.idealSpeed !== null && data.idealSpeed <= 0)
    throw new CustomError(400, 'error.must_be_positive')

  // 5. validFrom defaults to now if not provided
  // (handled in service.create)
}

// Applied check — is this standard "in use" by any started job order?
async function isApplied(standardId: string): Promise<boolean> {
  const standard = await ProductStandard.findById(standardId)
  if (!standard) return false

  // Find all started job orders for this product+workCenter
  const jobOrders = await JobOrder.find({
    productId: standard.productId,
    workCenterId: standard.workCenterId,
    startTime: { $ne: null },
  }).select('startTime').lean()

  for (const jo of jobOrders) {
    // For each started JO, find the latest standard where validFrom <= startTime
    const applicable = await ProductStandard.findOne({
      productId: standard.productId,
      workCenterId: standard.workCenterId,
      validFrom: { $lte: jo.startTime },
    }).sort({ validFrom: -1 }).select('_id').lean()

    if (applicable && applicable._id.toString() === standardId) return true
  }
  return false
}

// Update — block if applied
async function update(id: string, data: PatchInput, userId: string) {
  if (await isApplied(id)) throw new CustomError(409, 'error.product_standard_applied')
  // productId, workCenterId, validFrom are immutable
  // ... proceed with update
}

// Delete — block if applied OR last revision with existing job orders
async function remove(id: string) {
  if (await isApplied(id)) throw new CustomError(409, 'error.product_standard_applied')

  const standard = await ProductStandard.findById(id)
  if (!standard) throw new CustomError(404, 'error.not_found')

  // Check if last remaining revision for product+workCenter
  const revisionCount = await ProductStandard.countDocuments({
    productId: standard.productId,
    workCenterId: standard.workCenterId,
  })

  if (revisionCount <= 1) {
    // Last revision — only allow delete if no job orders exist
    const joCount = await JobOrder.countDocuments({
      productId: standard.productId,
      workCenterId: standard.workCenterId,
    })
    if (joCount > 0) throw new CustomError(409, 'error.product_standard_last_revision')
  }

  // Proceed with delete
}
```

**Controller:** Work-center-bound — uses `resolveVisibility`. List/get filters by `visibleIds`. Create/update/delete checks `workCenterId ∈ visibleIds`.

**Routes path:** `/product-standards`. Permissions: `readProductStandards`, `writeProductStandards`, `deleteProductStandards`.

**List filters:** `_id`, `productId`, `workCenterId`, `createdBy`, `validFromFrom`/`validFromTo` (date range), `createdAtFrom`/`createdAtTo`. No search. Sort: `validFrom`, `idealOutputPerMinute`, `createdAt`, `updatedAt`.

- [ ] **Step 1:** Write model with compound unique index
- [ ] **Step 2:** Write validators (including date range filters)
- [ ] **Step 3:** Write service with applied check, immutable fields, delete rules
- [ ] **Step 4:** Write controller with visibility
- [ ] **Step 5:** Write routes
- [ ] **Step 6:** Write tests — key cases:
  - Create with valid product + physical WC + correct productivity mode fields
  - Reject non-physical WC
  - Reject missing counterMultiplier for count_based WC
  - Applied standard blocks update and delete
  - Unapplied standard allows update and delete
  - Last revision delete blocked when job orders exist
  - Last revision delete allowed when no job orders exist
- [ ] **Step 7:** Run tests
- [ ] **Step 8:** Commit: `feat: add product-standard module with applied/immutable rules`

---

## Phase 4: Plans

### Task 7: ProductionPlan module

**Permission-only** entity with parent-child constraints.

**Schema fields:**
```typescript
code: { type: String, required: true, unique: true, trim: true }
productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true }
targetQuantity: { type: Number, required: true }
dueAt: { type: Date, default: null }
description: { type: String, default: null }
props: { type: Map, of: String, default: () => new Map() }
createdBy: { type: Schema.Types.ObjectId, required: true }
updatedBy: { type: Schema.Types.ObjectId, default: null }
```

**Service — create validation and parent-child constraint logic:**

```typescript
// Create — validate Product ref
async function create(data: CreateInput, userId: string) {
  const product = await Product.findById(data.productId)
  if (!product) throw new CustomError(404, 'error.not_found')
  return ProductionPlan.create({ ...data, createdBy: userId, updatedBy: userId })
}

async function hasChildren(planId: string): Promise<boolean> {
  return (await JobOrder.countDocuments({ productionPlanId: planId })) > 0
}

async function getChildTargetSum(planId: string, excludeJobOrderId?: string): Promise<number> {
  const match: Record<string, unknown> = { productionPlanId: planId }
  if (excludeJobOrderId) match._id = { $ne: excludeJobOrderId }
  const result = await JobOrder.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$targetQuantity' } } },
  ])
  return result[0]?.total ?? 0
}

// Update — enforce immutability and constraint
async function update(id: string, data: PatchInput, userId: string) {
  const plan = await ProductionPlan.findById(id)
  if (!plan) throw new CustomError(404, 'error.not_found')

  const hasKids = await hasChildren(id)

  // productId immutable after first child
  if (data.productId && hasKids) throw new CustomError(409, 'error.plan_immutable_field')
  // code immutable after first child
  if (data.code && hasKids) throw new CustomError(409, 'error.plan_immutable_field')

  // targetQuantity: new value must >= sum of child targets
  if (data.targetQuantity !== undefined) {
    const childSum = await getChildTargetSum(id)
    if (data.targetQuantity < childSum) throw new CustomError(409, 'error.plan_target_exceeded')
  }

  // ... proceed with update
}

// Delete — block if has children
async function remove(id: string) {
  if (await hasChildren(id)) throw new CustomError(409, 'error.referenced')
  // ... proceed with delete
}
```

**Delete check:** Block if any `JobOrder.productionPlanId` references it.

**Routes path:** `/production-plans`. Permissions: `readProductionPlans`, `writeProductionPlans`, `deleteProductionPlans`.

**List filters:** `_id`, `code`, `productId`, `createdBy`, `dueAtFrom`/`dueAtTo`, `createdAtFrom`/`createdAtTo`. Search: `code`, `description`. Sort: `code`, `targetQuantity`, `dueAt`, `createdAt`, `updatedAt`.

- [ ] **Step 1:** Write model, validators, service with parent-child constraints
- [ ] **Step 2:** Write controller (permission-only) and routes
- [ ] **Step 3:** Write tests — key cases:
  - productId and code immutable after first child JobOrder
  - targetQuantity can't drop below child sum
  - Delete blocked when children exist
- [ ] **Step 4:** Run tests
- [ ] **Step 5:** Commit: `feat: add production-plan module with parent-child constraints`

---

## Phase 5: Job Orders

### Task 8: JobOrder model and basic CRUD

**Schema fields:**
```typescript
code: { type: String, required: true, unique: true, trim: true }
productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true }
workCenterId: { type: Schema.Types.ObjectId, required: true, index: true } // cross-service ref, no local model
productionPlanId: { type: Schema.Types.ObjectId, ref: 'ProductionPlan', default: null, index: true }
targetQuantity: { type: Number, required: true }
plannedStartAt: { type: Date, default: null }
dueAt: { type: Date, default: null }
startTime: { type: Date, default: null }
endTime: { type: Date, default: null }
description: { type: String, default: null }
props: { type: Map, of: String, default: () => new Map() }
createdBy: { type: Schema.Types.ObjectId, required: true }
updatedBy: { type: Schema.Types.ObjectId, default: null }
startedBy: { type: Schema.Types.ObjectId, default: null }
endedBy: { type: Schema.Types.ObjectId, default: null }
```

**Indexes:**
```typescript
{ workCenterId: 1, startTime: 1, endTime: 1 }  // overlap queries
{ productionPlanId: 1 }                          // parent-child queries
{ productId: 1, workCenterId: 1 }               // standard resolution
```

**Service — create validation:**
```typescript
async function create(data: CreateInput, userId: string) {
  // Product must exist
  // WorkCenter must be physical
  // targetQuantity > 0
  // At least one ProductStandard with validFrom <= now for product+workCenter
  // If productionPlanId: plan must exist, product must match, child sum check
  // startTime and endTime always null on create

  const doc = await JobOrder.create({
    ...data,
    startTime: null,
    endTime: null,
    startedBy: null,
    endedBy: null,
    createdBy: userId,
    updatedBy: userId,
  })
  emitJobOrderCreated(doc._id.toString())
  return doc
}
```

**Patch — state-dependent editability:**
```typescript
async function update(id: string, data: PatchInput, userId: string) {
  const jo = await JobOrder.findById(id)
  if (!jo) throw new CustomError(404, 'error.not_found')

  // Block immutable actor fields
  // createdBy, updatedBy, startedBy, endedBy cannot be patched

  const isStarted = jo.startTime !== null

  if (isStarted) {
    // Only dueAt, description, props editable after start
    const forbidden = ['code', 'productId', 'workCenterId', 'productionPlanId', 'targetQuantity', 'plannedStartAt']
    for (const f of forbidden) {
      if (data[f] !== undefined) throw new CustomError(409, 'error.immutable_field')
    }
  } else {
    // All business fields editable before start
    // If changing productionPlanId or targetQuantity, re-check parent constraints
    if (data.productionPlanId !== undefined || data.targetQuantity !== undefined) {
      await validateParentChildConstraints(jo, data)
    }
  }

  // ... proceed with update
}
```

**Delete:** Only if `startTime == null` AND no QA/ScrapEntry references.

**List filters:** See spec — `runtimeState` derived filter, `activeFrom`/`activeTo` interval, comma-separated multi-value filters.

**Controller:** Work-center-bound — uses `resolveVisibility`.

**Routes path:** `/job-orders`. Permissions: `readJobOrders`, `writeJobOrders`, `deleteJobOrders`.

- [ ] **Step 1:** Write model with indexes
- [ ] **Step 2:** Write validators (including runtimeState enum, date range filters, activeFrom/activeTo)
- [ ] **Step 3:** Write service — create with all validations, patch with state-dependent rules, delete with checks
- [ ] **Step 4:** Write controller with visibility and list filter building
- [ ] **Step 5:** Write routes
- [ ] **Step 6:** Write tests — create validations, patch state rules, delete checks, list filters
- [ ] **Step 7:** Run tests
- [ ] **Step 8:** Commit: `feat: add job-order module with CRUD and state-dependent rules`

---

### Task 9: JobOrder start lifecycle

**Routes:** `POST /job-orders/:id/start` with permission `executeJobOrders`.

**Service logic:**
```typescript
async function start(id: string, body: { startTime?: Date }, userId: string, visibleIds?: string[]) {
  const jo = await JobOrder.findById(id)
  if (!jo) throw new CustomError(404, 'error.not_found')

  // Visibility check
  if (visibleIds && !visibleIds.includes(jo.workCenterId.toString())) {
    throw new CustomError(404, 'error.not_found')
  }

  // Already started?
  if (jo.startTime) throw new CustomError(409, 'error.job_order_already_started')

  const actualStart = body.startTime ? new Date(body.startTime) : new Date()

  // startTime <= now
  if (actualStart > new Date()) throw new CustomError(400, 'error.job_order_start_future')

  // No other active job on same work center
  const activeJo = await JobOrder.findOne({
    workCenterId: jo.workCenterId,
    startTime: { $ne: null },
    endTime: null,
    _id: { $ne: jo._id },
  })
  if (activeJo) throw new CustomError(409, 'error.job_order_active_exists')

  // Interval overlap check: [actualStart, +inf) vs existing [startTime, endTime] on same WC
  // Standard interval intersection: A.start < B.end AND A.end > B.start
  // Since new job has no endTime yet (+inf), any started job with endTime > actualStart overlaps
  const overlapping = await JobOrder.findOne({
    workCenterId: jo.workCenterId,
    _id: { $ne: jo._id },
    startTime: { $ne: null },
    $or: [
      { endTime: null }, // running job — open interval always overlaps (redundant with active check, kept for safety)
      { endTime: { $gt: actualStart } }, // finished job whose interval extends past our start
    ],
  })
  if (overlapping) throw new CustomError(409, 'error.job_order_overlap')

  // Applicable standard: latest(validFrom <= actualStart)
  const standard = await ProductStandard.findOne({
    productId: jo.productId,
    workCenterId: jo.workCenterId,
    validFrom: { $lte: actualStart },
  }).sort({ validFrom: -1 })
  if (!standard) throw new CustomError(400, 'error.job_order_no_standard')

  // Update
  const updated = await JobOrder.findOneAndUpdate(
    { _id: id },
    { $set: { startTime: actualStart, startedBy: userId, updatedBy: userId } },
    { new: true, runValidators: true },
  )
  emitJobOrderStarted(id, jo.workCenterId.toString())
  return updated
}
```

- [ ] **Step 1:** Add start method to job-order service
- [ ] **Step 2:** Add start controller and route (`POST /job-orders/:id/start`)
- [ ] **Step 3:** Write start tests:
  - Successful start with default now
  - Successful start with backdated startTime
  - Reject future startTime
  - Reject already started
  - Reject when another active job on same WC
  - Reject when no applicable standard
  - Reject when interval overlaps with finished job
- [ ] **Step 4:** Run tests
- [ ] **Step 5:** Commit: `feat: add job-order start lifecycle`

---

### Task 10: JobOrder end lifecycle

**Routes:** `POST /job-orders/:id/end` with permission `executeJobOrders`.

**Service logic:**
```typescript
async function end(id: string, body: { endTime?: Date }, userId: string, visibleIds?: string[]) {
  const jo = await JobOrder.findById(id)
  if (!jo) throw new CustomError(404, 'error.not_found')

  if (visibleIds && !visibleIds.includes(jo.workCenterId.toString())) {
    throw new CustomError(404, 'error.not_found')
  }

  if (!jo.startTime) throw new CustomError(409, 'error.job_order_not_started')
  if (jo.endTime) throw new CustomError(409, 'error.job_order_already_ended')

  const actualEnd = body.endTime ? new Date(body.endTime) : new Date()

  // endTime <= now
  if (actualEnd > new Date()) throw new CustomError(400, 'error.job_order_end_future')

  // endTime >= startTime
  if (actualEnd < jo.startTime) throw new CustomError(400, 'error.job_order_end_before_start')

  // Interval overlap check with custom endTime
  // [jo.startTime, actualEnd] must not overlap with other jobs on same WC
  const overlapping = await JobOrder.findOne({
    workCenterId: jo.workCenterId,
    _id: { $ne: jo._id },
    startTime: { $ne: null, $lt: actualEnd },
    $or: [
      { endTime: null },
      { endTime: { $gt: jo.startTime } },
    ],
  })
  if (overlapping) throw new CustomError(409, 'error.job_order_overlap')

  const updated = await JobOrder.findOneAndUpdate(
    { _id: id },
    { $set: { endTime: actualEnd, endedBy: userId, updatedBy: userId } },
    { new: true, runValidators: true },
  )
  emitJobOrderEnded(id, jo.workCenterId.toString())
  return updated
}
```

- [ ] **Step 1:** Add end method to job-order service
- [ ] **Step 2:** Add end controller and route (`POST /job-orders/:id/end`)
- [ ] **Step 3:** Write end tests:
  - Successful end with default now
  - Successful end with backdated endTime
  - Reject future endTime
  - Reject if not started
  - Reject if already ended
  - Reject endTime < startTime
  - Reject overlap with custom endTime
- [ ] **Step 4:** Run tests
- [ ] **Step 5:** Commit: `feat: add job-order end lifecycle`

---

### Task 11: JobOrder advanced filters

Implement `runtimeState`, `activeFrom`/`activeTo`, and multi-value filters in the list query.

**Service — filter building:**
```typescript
function buildJobOrderFilters(input: JobOrderListInput, visibleIds?: string[]): Record<string, unknown> {
  const query: Record<string, unknown> = {}

  // Visibility
  if (visibleIds) query.workCenterId = { $in: visibleIds }

  // Simple filters
  for (const key of ['_id', 'code', 'productionPlanId', 'workCenterId', 'productId', 'createdBy', 'startedBy', 'endedBy']) {
    if (input[key] !== undefined) query[key] = input[key]
  }

  // Multi-value (comma-separated → $in)
  if (input.workCenterIds) query.workCenterId = { $in: input.workCenterIds.split(',') }
  if (input.productIds) query.productId = { $in: input.productIds.split(',') }

  // Runtime state (derived)
  if (input.runtimeState === 'pending') query.startTime = null
  if (input.runtimeState === 'running') { query.startTime = { $ne: null }; query.endTime = null }
  if (input.runtimeState === 'finished') { query.startTime = { $ne: null }; query.endTime = { $ne: null } }

  // Date ranges (createdAt, plannedStartAt, startTime, endTime, dueAt)
  // ... standard $gte/$lte pattern for From/To pairs

  // activeFrom/activeTo — execution interval intersection
  if (input.activeFrom || input.activeTo) {
    query.startTime = { $ne: null } // only started jobs
    if (input.activeFrom && input.activeTo) {
      // interval [startTime, endTime||+inf) must intersect [activeFrom, activeTo]
      query.$and = [
        { $or: [{ endTime: null }, { endTime: { $gt: input.activeFrom } }] },
        { startTime: { $lt: input.activeTo } },
      ]
    } else if (input.activeFrom) {
      // still active after activeFrom
      query.$or = [{ endTime: null }, { endTime: { $gt: input.activeFrom } }]
    } else if (input.activeTo) {
      // started before activeTo
      query.startTime = { ...query.startTime, $lt: input.activeTo }
    }
  }

  return query
}
```

- [ ] **Step 1:** Implement buildJobOrderFilters in service
- [ ] **Step 2:** Update validators for multi-value and date range params
- [ ] **Step 3:** Write filter tests:
  - runtimeState: pending, running, finished
  - activeFrom/activeTo interval intersection
  - Comma-separated workCenterIds, productIds
  - Date range filters
- [ ] **Step 4:** Run tests
- [ ] **Step 5:** Commit: `feat: add job-order advanced filters`

---

## Phase 6: Adjustments

### Task 12: QuantityAdjustment module

**Work-center-bound** entity linked to a started JobOrder.

**Schema fields:**
```typescript
jobOrderId: { type: Schema.Types.ObjectId, ref: 'JobOrder', required: true, index: true }
workCenterId: { type: Schema.Types.ObjectId, required: true, index: true }
productId: { type: Schema.Types.ObjectId, required: true }
shiftId: { type: Schema.Types.ObjectId, required: true }
amount: { type: Number, required: true }
time: { type: Date, required: true }
reason: { type: String, default: null }
description: { type: String, default: null }
createdBy: { type: Schema.Types.ObjectId, required: true }
updatedBy: { type: Schema.Types.ObjectId, default: null }
```

**Service — create:**
```typescript
async function create(data: CreateInput, userId: string) {
  const jo = await JobOrder.findById(data.jobOrderId)
  if (!jo) throw new CustomError(404, 'error.not_found')
  if (!jo.startTime) throw new CustomError(400, 'error.job_order_not_started_for_adjustment')

  if (data.amount === 0) throw new CustomError(400, 'error.amount_zero')
  if (new Date(data.time) < jo.startTime) throw new CustomError(400, 'error.job_order_time_before_start')

  const doc = await QuantityAdjustment.create({
    ...data,
    workCenterId: jo.workCenterId,
    productId: jo.productId,
    createdBy: userId,
    updatedBy: userId,
  })
  emitQuantityAdjustmentCreated(doc._id.toString())
  return doc
}
```

**Patch immutable fields:** `jobOrderId`, `workCenterId`, `productId`, `createdBy`. Time validation also applies on patch.

**Delete:** Allowed unconditionally.

**Routes path:** `/quantity-adjustments`. Permissions: `readProductionAdjustments`, `writeProductionAdjustments`, `deleteProductionAdjustments`.

- [ ] **Step 1:** Write model, validators, service (with JO started check, time validation, server-side fill)
- [ ] **Step 2:** Write controller (work-center-bound visibility) and routes
- [ ] **Step 3:** Write tests:
  - Create fills workCenterId/productId from JobOrder
  - Rejects if JO not started
  - Rejects amount === 0
  - Rejects time before JO startTime
  - Patch rejects time before JO startTime (same validation as create)
  - Allows create/patch/delete on finished JO
  - Patch blocks immutable fields (jobOrderId, workCenterId, productId, createdBy)
- [ ] **Step 4:** Run tests
- [ ] **Step 5:** Commit: `feat: add quantity-adjustment module`

---

### Task 13: ScrapEntry module

Similar to QuantityAdjustment but uses `startTime`/`endTime` range instead of single `time`.

**Schema fields:**
```typescript
jobOrderId: { type: Schema.Types.ObjectId, ref: 'JobOrder', required: true, index: true }
workCenterId: { type: Schema.Types.ObjectId, required: true, index: true }
productId: { type: Schema.Types.ObjectId, required: true }
shiftId: { type: Schema.Types.ObjectId, required: true }
amount: { type: Number, required: true }
startTime: { type: Date, required: true }
endTime: { type: Date, required: true }
causeId: { type: Schema.Types.ObjectId, default: null }
description: { type: String, default: null }
props: { type: Map, of: String, default: () => new Map() }
createdBy: { type: Schema.Types.ObjectId, required: true }
updatedBy: { type: Schema.Types.ObjectId, default: null }
```

**Service — create:**
```typescript
async function create(data: CreateInput, userId: string) {
  const jo = await JobOrder.findById(data.jobOrderId)
  if (!jo) throw new CustomError(404, 'error.not_found')
  if (!jo.startTime) throw new CustomError(400, 'error.job_order_not_started_for_adjustment')

  if (data.amount <= 0) throw new CustomError(400, 'error.must_be_positive')
  if (new Date(data.endTime) <= new Date(data.startTime)) throw new CustomError(400, 'error.scrap_end_before_start')
  if (new Date(data.startTime) < jo.startTime) throw new CustomError(400, 'error.job_order_time_before_start')

  const doc = await ScrapEntry.create({
    ...data,
    workCenterId: jo.workCenterId,
    productId: jo.productId,
    createdBy: userId,
    updatedBy: userId,
  })
  emitScrapEntryCreated(doc._id.toString())
  return doc
}
```

**Patch immutable fields:** `jobOrderId`, `workCenterId`, `productId`, `createdBy`. Time range validations (`endTime > startTime`, `startTime >= JO.startTime`) also apply on patch.

**Delete:** Allowed unconditionally.

**List filters:** `_id`, `jobOrderId`, `workCenterId`, `productId`, `shiftId`, `causeId`, `createdBy`, `startTimeFrom`/`startTimeTo`, `endTimeFrom`/`endTimeTo`, `createdAtFrom`/`createdAtTo`. Search: `description`. Sort: `startTime`, `endTime`, `amount`, `createdAt`, `updatedAt`.

- [ ] **Step 1:** Write model, validators, service (startTime/endTime range validation, patch immutability)
- [ ] **Step 2:** Write controller and routes
- [ ] **Step 3:** Write tests:
  - endTime > startTime enforced
  - startTime >= JO startTime enforced
  - amount > 0 enforced
  - Create fills workCenterId/productId from JO
  - Allows create/patch/delete on finished JO
  - Patch rejects time range violations (same validations as create)
  - Patch blocks immutable fields (jobOrderId, workCenterId, productId, createdBy)
  - Range filters work correctly
- [ ] **Step 4:** Run tests
- [ ] **Step 5:** Commit: `feat: add scrap-entry module with time range`

---

## Phase 7: Cross-Service Integration

### Task 14: Internal API endpoint

**File:** Add to `production/src/modules/job-order/job-order.routes.ts`

Endpoint: `GET /internal/v1/work-centers/:id/references`

Response: `{ data: { inUse: boolean, hasStartedJobOrders: boolean } }`

```typescript
export const workCenterReferencesInternalRoutes = Router()

workCenterReferencesInternalRoutes.get(
  '/work-centers/:id/references',
  validateParams(workCenterIdParamSchema),
  async (req: Request<{ id: string }>, res: Response) => {
    const wcId = req.params.id

    const [totalRefs, startedJOs] = await Promise.all([
      // inUse: any record in ProductStandard, JobOrder, QA, or ScrapEntry
      Promise.all([
        ProductStandard.countDocuments({ workCenterId: wcId }),
        JobOrder.countDocuments({ workCenterId: wcId }),
        QuantityAdjustment.countDocuments({ workCenterId: wcId }),
        ScrapEntry.countDocuments({ workCenterId: wcId }),
      ]).then(counts => counts.reduce((a, b) => a + b, 0)),
      // hasStartedJobOrders
      JobOrder.countDocuments({ workCenterId: wcId, startTime: { $ne: null } }),
    ])

    res.json({
      data: {
        inUse: totalRefs > 0,
        hasStartedJobOrders: startedJOs > 0,
      },
    })
  },
)
```

Mount in `express.ts`: `internalRouter.use(workCenterReferencesInternalRoutes)` after `mountSharedRoutes(internalRouter)`.

- [ ] **Step 1:** Add internal route handler
- [ ] **Step 2:** Mount in express.ts internal router
- [ ] **Step 3:** Write tests
- [ ] **Step 4:** Run tests
- [ ] **Step 5:** Commit: `feat: add internal work-center references endpoint`

---

### Task 15: Docker Compose integration

**Files:**
- Create: `production/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create `production/Dockerfile`**

Copy from `work-center/Dockerfile`, change:
- Filter name: `production-service`
- Build command: `pnpm --filter production-service run build`

- [ ] **Step 2: Add to `docker-compose.yml`**

```yaml
  production:
    build:
      context: .
      dockerfile: production/Dockerfile
    container_name: production_app
    restart: unless-stopped
    env_file:
      - ./production/.env
    environment:
      - MONGO_URI=${MONGO_URI:-mongodb://mongodb:27017/mes?directConnection=true}
      - REDIS_URL=${REDIS_URL:-redis://redis:6379}
      - JWT_SECRET=${JWT_SECRET:-supersecretkey}
      - INTERNAL_API_USER=${INTERNAL_API_USER:-http://user:3000}
      - INTERNAL_API_WORK_CENTER=${INTERNAL_API_WORK_CENTER:-http://work-center:3001}
    depends_on:
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - mes_network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3002/health/ready"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=mes_network"
      - "traefik.http.routers.production-uoms.rule=PathPrefix(`/api/v1/uoms`)"
      - "traefik.http.routers.production-uoms.entrypoints=web"
      - "traefik.http.routers.production-uoms.priority=5"
      - "traefik.http.routers.production-uoms.middlewares=global-compress@docker,secure-headers@docker,rate-limit@docker,body-limit@docker"
      - "traefik.http.routers.production-uoms.service=production"
      - "traefik.http.routers.production-categories.rule=PathPrefix(`/api/v1/product-categories`)"
      - "traefik.http.routers.production-categories.entrypoints=web"
      - "traefik.http.routers.production-categories.priority=5"
      - "traefik.http.routers.production-categories.middlewares=global-compress@docker,secure-headers@docker,rate-limit@docker,body-limit@docker"
      - "traefik.http.routers.production-categories.service=production"
      - "traefik.http.routers.production-products.rule=PathPrefix(`/api/v1/products`)"
      - "traefik.http.routers.production-products.entrypoints=web"
      - "traefik.http.routers.production-products.priority=5"
      - "traefik.http.routers.production-products.middlewares=global-compress@docker,secure-headers@docker,rate-limit@docker,body-limit@docker"
      - "traefik.http.routers.production-products.service=production"
      - "traefik.http.routers.production-standards.rule=PathPrefix(`/api/v1/product-standards`)"
      - "traefik.http.routers.production-standards.entrypoints=web"
      - "traefik.http.routers.production-standards.priority=5"
      - "traefik.http.routers.production-standards.middlewares=global-compress@docker,secure-headers@docker,rate-limit@docker,body-limit@docker"
      - "traefik.http.routers.production-standards.service=production"
      - "traefik.http.routers.production-plans.rule=PathPrefix(`/api/v1/production-plans`)"
      - "traefik.http.routers.production-plans.entrypoints=web"
      - "traefik.http.routers.production-plans.priority=5"
      - "traefik.http.routers.production-plans.middlewares=global-compress@docker,secure-headers@docker,rate-limit@docker,body-limit@docker"
      - "traefik.http.routers.production-plans.service=production"
      - "traefik.http.routers.production-jobs.rule=PathPrefix(`/api/v1/job-orders`)"
      - "traefik.http.routers.production-jobs.entrypoints=web"
      - "traefik.http.routers.production-jobs.priority=5"
      - "traefik.http.routers.production-jobs.middlewares=global-compress@docker,secure-headers@docker,rate-limit@docker,body-limit@docker"
      - "traefik.http.routers.production-jobs.service=production"
      - "traefik.http.routers.production-adjustments.rule=PathPrefix(`/api/v1/quantity-adjustments`)"
      - "traefik.http.routers.production-adjustments.entrypoints=web"
      - "traefik.http.routers.production-adjustments.priority=5"
      - "traefik.http.routers.production-adjustments.middlewares=global-compress@docker,secure-headers@docker,rate-limit@docker,body-limit@docker"
      - "traefik.http.routers.production-adjustments.service=production"
      - "traefik.http.routers.production-scrap.rule=PathPrefix(`/api/v1/scrap-entries`)"
      - "traefik.http.routers.production-scrap.entrypoints=web"
      - "traefik.http.routers.production-scrap.priority=5"
      - "traefik.http.routers.production-scrap.middlewares=global-compress@docker,secure-headers@docker,rate-limit@docker,body-limit@docker"
      - "traefik.http.routers.production-scrap.service=production"
      - "traefik.http.services.production.loadbalancer.server.port=3002"
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
```

- [ ] **Step 3: Full stack test**

Run: `docker compose up -d --build production`
Verify: `curl http://localhost/health/ready` through Traefik returns 200

- [ ] **Step 4: Commit**

```bash
git commit -m "build: add production-service Docker and Compose config"
```

---

### Task 16: Final integration and cleanup

- [ ] **Step 1:** Run full test suite: `cd production && pnpm test`
- [ ] **Step 2:** Run typecheck: `cd production && pnpm typecheck`
- [ ] **Step 3:** Run lint: `pnpm lint:fix`
- [ ] **Step 4:** Verify all 8 entities CRUD works end-to-end
- [ ] **Step 5:** Verify internal endpoint responds correctly
- [ ] **Step 6:** Verify events are published to Redis stream `events.production`
- [ ] **Step 7:** Final commit: `feat: complete production-service implementation`
