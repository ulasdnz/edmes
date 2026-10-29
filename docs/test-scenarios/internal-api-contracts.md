# Test Scenarios: internal API contracts (provider side)

> added: 2026-10-29
> Consumers stub these endpoints in their own tests, so nothing else checks that the real
> provider still answers the way the consumer expects. Each scenario replays the consumer's
> real request against the provider app (real MongoDB) and asserts the fields the consumer reads.

---

## Production -> performance
> target: production/src/test/contracts/performance.contract.test.ts
> consumer: performance/src/lib/internal-api/production.client.ts

### GET /internal/v1/job-orders (findStartedJobOrders, OEE job windows)
- [CRITICAL] the exact query performance sends (`workCenterId`, `activeFrom`, `activeTo`, `limit=500`, `page=1`) is accepted with 200 and `data` is an array
- [CRITICAL] returns the started job orders of that work center that overlap the window, running ones included (`endTime: null`), each with `_id`, `workCenterId`, `productId`, `startTime`, `endTime`, `code`; pending, out-of-window and other work centers' job orders are excluded
- [CRITICAL] a call without the internal token is rejected with 401

### POST /internal/v1/product-standards/timelines:batch (OEE productivity targets)
- [CRITICAL] each item comes back with `jobOrderId`, `qualityFlags` and `standards`, and every standard has `_id`, `validFrom`, `idealOutputPerMinute`, `counterMultiplier` and `idealSpeed` (speed-based OEE reads `idealSpeed`)
- [HIGH] no standard valid at `from` -> `qualityFlags: ['no_standard_for_interval']`

### POST /internal/v1/job-order-records:batch (OEE quality)
- [HIGH] returns `quantityAdjustmentsByJobOrderId` and `scrapEntriesByJobOrderId` keyed by job order id; quantity adjustments carry `_id`, `amount`, `time`, scrap entries carry `_id`, `amount`, `reasonId`, `startTime`, `endTime`

---

## Work-center -> performance, production
> target: work-center/src/test/contracts/internal-consumers.contract.test.ts
> consumers: performance/src/lib/internal-api/work-center.client.ts, production/src/lib/internal-api.ts

### GET /internal/v1/work-centers/:id
- [CRITICAL] a physical work center returns `type`, `productivityMode`, `status` and `tagBindings` with the names performance reads for OEE: `runModeTagId`, `speedTagId`, `producedCounterTagId`
- [HIGH] a virtual work center returns `type: 'virtual'` and its `metricComposition`
- [HIGH] an unknown id -> 404 (both consumers treat 404 as "not found")

### GET /internal/v1/shifts/:id (production assertShiftExists)
- [HIGH] an existing shift -> 200; an unknown id -> 404 (production turns 404 into `production.shift_not_found` and anything else into 503)

---

Already covered elsewhere:
- `GET /internal/v1/work-centers/run-mode-monitors` -> work-center/src/modules/internal/__tests__/run-mode-monitors.test.ts
- `GET /internal/v1/shifts/:id/references` -> production/src/modules/internal/shift-references.test.ts
