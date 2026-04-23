# Production-Service Specification

Decision-complete specification for a new on-prem MES `production-service`, following the same structural conventions as `work-center-service`.

## Summary

- `production-service` owns `Uom`, `ProductCategory`, `Product`, `ProductStandard`, `ProductionPlan`, `JobOrder`, `QuantityAdjustment`, and `ScrapEntry`.
- It does not own raw telemetry, tag history, OEE results, work center master data, cause master data, or shift definitions.
- `JobOrder` is the primary execution aggregate. `ProductionPlan` is an optional upper planning container; job orders can be created and executed independently.
- Public access requires the relevant module permission. Work-center-bound records are additionally scoped by the caller's `workCenterIds`; `Uom`, `ProductCategory`, `Product`, and `ProductionPlan` use permission-only visibility. Internal routes use the system-bypass convention.
- Public API uses Mongo `_id` as the identity field, keeps `createdAt` and `updatedAt` on mutable aggregates, fills actor fields from authenticated user context, uses shared audit logging, follows `PATCH`-based updates, and publishes domain events defined below.

## Domain Model

### Uom

Amaç: ölçü birimi tanımı.

Alanlar:

- `code: string` unique
- `name: string`
- `symbol: string`
- `createdAt: Date`
- `updatedAt: Date`

### ProductCategory

Amaç: ürün kategorisi.

Alanlar:

- `code: string` unique
- `name: string`
- `description?: string | null`
- `createdAt: Date`
- `updatedAt: Date`

### Product

Amaç: üretilecek ürün master kaydı.

Alanlar:

- `code: string` unique
- `name: string`
- `description?: string | null`
- `categoryId?: ObjectId | null`
- `kind: 'finished' | 'semi_finished'`
- `uomId: ObjectId`
- `props?: Record<string, string>`
- `createdAt: Date`
- `updatedAt: Date`

Kurallar:

- `Product` yalnız katalog alanlarını içerir
- `uomId` zorunludur
- Referenced `Uom` mevcut olmalıdır
- `categoryId` gönderilirse referenced `ProductCategory` mevcut olmalıdır
- `uomId`, ürün miktarının kanonik ölçü birimidir
- `targetQuantity`, `idealOutputPerMinute`, `grossProduction`, `scrap` ve `quantity adjustment` yorumları bu birim üzerinden yapılır
- Tüm business alanları editlenebilir

### ProductStandard

Amaç: belirli bir `product + workCenter` için üretim standardı.

Alanlar:

- `productId: ObjectId`
- `workCenterId: ObjectId`
- `validFrom: Date`
- `idealOutputPerMinute: number`
- `counterMultiplier?: number`
- `idealSpeed?: number`
- `createdBy: ObjectId`
- `updatedBy?: ObjectId | null`
- `createdAt: Date`
- `updatedAt: Date`

Kurallar:

- Referenced `Product` mevcut olmalıdır
- Referenced `WorkCenter` mevcut ve fiziksel olmalıdır
- Create body içinde `validFrom` zorunlu değildir; verilmezse server `now` set eder
- `validFrom` ileri tarihli olabilir
- Aynı `productId + workCenterId + validFrom` duplicate olamaz
- `idealCycleTime` kalıcı alan değildir; gerekirse `idealOutputPerMinute` üzerinden türetilir
- `idealOutputPerMinute > 0` olmalıdır
- `counterMultiplier` verilirse `> 0` olmalıdır
- `idealSpeed` verilirse `> 0` olmalıdır
- `updatedBy`, update işlemlerinde authenticated user üzerinden server tarafında doldurulur
- `productId`, `workCenterId`, `validFrom` create sonrası değişmez
- Bir `ProductStandard`, herhangi bir started `JobOrder` için start anında `latest(validFrom <= jobOrder.startTime)` seçimiyle eşleşiyorsa uygulanmış kabul edilir
- Uygulanmamış `ProductStandard` kayıtları update ve delete alabilir
- Uygulanmış `ProductStandard` kayıtları immutable kabul edilir; update ve delete alamaz
- Uygulanmış bir standardda değişiklik ihtiyacı yeni bir `ProductStandard` kaydı oluşturularak çözülür

Work center bağımlılığı:

- Ölçüm modu owner'ı `work-center-service`tir
- Production-service, work center tarafındaki mevcut `productivityMode` alanını ölçüm modu olarak kullanır
- `count_based` work center için `counterMultiplier` zorunlu
- `speed_based` work center için `idealSpeed` zorunlu

### ProductionPlan

Amaç: opsiyonel üst plan kabı.

Alanlar:

- `code: string` unique
- `productId: ObjectId`
- `targetQuantity: number`
- `dueAt?: Date | null`
- `description?: string | null`
- `props?: Record<string, string>`
- `createdBy: ObjectId`
- `updatedBy?: ObjectId | null`
- `createdAt: Date`
- `updatedAt: Date`

Kurallar:

- Referenced `Product` mevcut olmalıdır
- `targetQuantity > 0` olmalıdır
- `updatedBy`, update işlemlerinde authenticated user üzerinden server tarafında doldurulur
- `ProductionPlan` olmadan da doğrudan `JobOrder` açılabilir
- Bir `ProductionPlan` çok `JobOrder` üretebilir
- Parent-child kuralları yalnız `productionPlanId` dolu `JobOrder` kayıtları için geçerlidir
- Child `JobOrder.productId`, parent `productId` ile aynı olmalı
- `sum(child.targetQuantity) <= parent.targetQuantity`
- Bu kısıt child `JobOrder` create ve patch işlemlerinde ve `ProductionPlan.targetQuantity` patch işleminde enforce edilir
- Child `JobOrder` kayıtları aşamalı oluşturulabilir; toplamın hemen parent target'a eşit olması gerekmez
- `ProductionPlan.targetQuantity` patch ile düşürülürse, yeni değer mevcut child toplamından küçük olamaz
- `productId`, ilk child oluştuktan sonra değişmez
- `code`, ilk child oluştuktan sonra değişmez
- `targetQuantity`, `dueAt`, `description`, `props` her zaman editlenebilir

### JobOrder

Amaç: tek work center üzerinde çalışan gerçek execution emri.

Alanlar:

- `code: string` unique
- `productId: ObjectId`
- `workCenterId: ObjectId`
- `productionPlanId?: ObjectId | null`
- `targetQuantity: number`
- `plannedStartAt?: Date | null`
- `dueAt?: Date | null`
- `startTime?: Date | null`
- `endTime?: Date | null`
- `description?: string | null`
- `props?: Record<string, string>`
- `createdBy: ObjectId`
- `updatedBy?: ObjectId | null`
- `startedBy?: ObjectId | null`
- `endedBy?: ObjectId | null`
- `createdAt: Date`
- `updatedAt: Date`

Kurallar:

- `productionPlanId` opsiyoneldir; standalone `JobOrder` tamamen geçerli kullanım şeklidir
- Referenced `Product` mevcut olmalıdır
- Referenced `WorkCenter` mevcut ve fiziksel olmalıdır
- `targetQuantity > 0` olmalıdır
- `productionPlanId` gönderilirse referenced `ProductionPlan` mevcut olmalıdır
- Create için `product + workCenter` üzerinde en az bir `ProductStandard.validFrom <= now` bulunmalı
- `productionPlanId` gönderilirse `JobOrder.productId`, parent `ProductionPlan.productId` ile aynı olmalıdır
- `productionPlanId` gönderilirse child target toplamı parent target değerini aşamaz
- Create sırasında `startTime` ve `endTime` her zaman `null` olur; request body üzerinden verilemez
- Start anında applicable standard kuralı:
  `latest(validFrom <= actualStartTime)`
- Start anında applicable standard yoksa start reddedilir
- `startedBy`, start işlemini yapan authenticated user üzerinden server tarafında doldurulur
- Aynı iş emri ikinci kez start edilemez
- Start komutu, aynı work center üzerindeki başka bir aktif iş emri varken kabul edilmez
- İki iş emrinin aynı work center üzerindeki execution aralıkları çakışamaz
- `POST /job-orders/{id}/start` body içinde `startTime` verilirse geçmiş tarih olabilir (backdating); `startTime <= now` zorunludur, gelecek tarih kabul edilmez; yine de overlap ve standard kuralları sağlanmalıdır
- Start öncesi şu alanlar editlenebilir:
  `code`, `productId`, `workCenterId`, `productionPlanId`, `targetQuantity`, `plannedStartAt`, `dueAt`, `description`, `props`
- Start sonrası yalnız `dueAt`, `description`, `props` editlenebilir
- `updatedBy`, patch işlemlerinde authenticated user üzerinden server tarafında doldurulur
- `createdBy`, `updatedBy`, `startedBy`, `endedBy` patch ile değiştirilemez
- Start sonrası `productionPlanId` değiştirilemez
- End komutu, start edilmemiş iş emrinde kullanılamaz
- `endedBy`, end işlemini yapan authenticated user üzerinden server tarafında doldurulur
- Aynı iş emri ikinci kez end edilemez
- `endTime >= startTime` zorunludur
- `endTime` request body'de verilirse geçmiş tarih olabilir (backdating); `endTime <= now` zorunludur, gelecek tarih kabul edilmez; interval overlap kuralını bozamaz

Runtime state kalıcı alan değildir:

- `pending`: `startTime == null`
- `running`: `startTime != null && endTime == null`
- `finished`: `startTime != null && endTime != null`

### QuantityAdjustment

Amaç: iş emri miktar düzeltmesi.

Persist edilen alanlar:

- `jobOrderId: ObjectId`
- `workCenterId: ObjectId`
- `productId: ObjectId`
- `shiftId: ObjectId`
- `amount: number`
- `time: Date`
- `reason?: string | null`
- `description?: string | null`
- `createdBy: ObjectId`
- `updatedBy?: ObjectId | null`
- `createdAt: Date`
- `updatedAt: Date`

Kurallar:

- `amount` pozitif veya negatif olabilir, `0` olamaz
- `updatedBy`, patch işlemlerinde authenticated user üzerinden server tarafında doldurulur
- Referenced `JobOrder` start edilmiş olmalıdır (`running` veya `finished`)
- `JobOrder` finished olduktan sonra da `QuantityAdjustment` create, patch ve delete yapılabilir; finished state bu kayıtları dondurmaz
- Create sırasında request body `jobOrderId`, `shiftId`, `amount`, `time`, `reason`, `description` taşır
- `shiftId` create body içinde zorunludur
- `workCenterId` ve `productId` referenced `JobOrder` üzerinden server tarafında doldurulur
- `time`, referenced `JobOrder.startTime` değerinden önce olamaz
- Aynı zaman aralığı validasyonları patch sırasında da uygulanır
- Patch sırasında `jobOrderId`, `workCenterId`, `productId`, `createdBy` değiştirilemez

### ScrapEntry

Amaç: fire/hurda kaydı.

Persist edilen alanlar:

- `jobOrderId: ObjectId`
- `workCenterId: ObjectId`
- `productId: ObjectId`
- `shiftId: ObjectId`
- `amount: number`
- `startTime: Date`
- `endTime: Date`
- `reasonId?: ObjectId | null`
- `description?: string | null`
- `createdBy: ObjectId`
- `updatedBy?: ObjectId | null`
- `createdAt: Date`
- `updatedAt: Date`
- `props?: Record<string, string>`

Kurallar:

- Referenced `JobOrder` start edilmiş olmalıdır (`running` veya `finished`)
- `JobOrder` finished olduktan sonra da `ScrapEntry` create, patch ve delete yapılabilir; finished state bu kayıtları dondurmaz
- `updatedBy`, patch işlemlerinde authenticated user üzerinden server tarafında doldurulur
- Create sırasında request body `jobOrderId`, `shiftId`, `amount`, `startTime`, `endTime`, `reasonId`, `description`, `props` taşır
- `shiftId` create body içinde zorunludur
- `startTime` ve `endTime` zorunludur
- `endTime > startTime` olmalıdır
- `amount > 0` olmalıdır
- `workCenterId` ve `productId` referenced `JobOrder` üzerinden server tarafında doldurulur
- `startTime`, referenced `JobOrder.startTime` değerinden önce olamaz
- Aynı zaman aralığı validasyonları patch sırasında da uygulanır
- Patch sırasında `jobOrderId`, `workCenterId`, `productId`, `createdBy` değiştirilemez

## Derived Values

Formül: `actualGoodQuantity = grossProduction - scrap + quantity adjustments`

- `actualGoodQuantity` kalıcı alan değildir
- `grossProduction` owner'ı `operations-service`tir
- `production-service` raw production counter veya speed history tutmaz
- `actualGoodQuantity` response tarafında zorunlu alan değildir; UI bu değeri `grossProduction - scrap + quantity adjustments` ile kendisi hesaplar
- `actualGoodQuantity` OEE quality kaynağı değildir. Performance OEE quality hesabı
  `ScrapEntry.reasonId` ve Performance Reason `affectsOee` politikasına göre
  `oeeAffectingScrap` / `excludedScrap` ayrımı yapar.
- `runtimeState` kalıcı alan değildir; UI bu değeri `startTime` ve `endTime` üzerinden kendisi hesaplar

## Public API

### Collection Lists

Tüm collection `GET` endpoint'leri `work-center-service` ile aynı pagination sözleşmesini kullanır:

- query: `page`, `limit`, `sort`, `search`
- response: `data`, `pagination { page, limit, total, totalPages }`
- default sort: `-createdAt`
- `sort` semantiği work-center ile aynıdır; desteklenmeyen alanlar yok sayılır

### Master Data

- `GET /uoms`
  - filters: `code`, `name`, `symbol`
  - search fields: `code`, `name`, `symbol`
  - allowed sort: `code`, `name`, `symbol`, `createdAt`, `updatedAt`
- `GET /uoms/{id}`
- `POST /uoms`
- `PATCH /uoms/{id}`
- `DELETE /uoms/{id}`

- `GET /product-categories`
  - filters: `code`, `name`
  - search fields: `code`, `name`
  - allowed sort: `code`, `name`, `createdAt`, `updatedAt`
- `GET /product-categories/{id}`
- `POST /product-categories`
- `PATCH /product-categories/{id}`
- `DELETE /product-categories/{id}`

- `GET /products`
  - filters: `_id`, `code`, `kind`, `categoryId`, `uomId`
  - search fields: `code`, `name`
  - allowed sort: `code`, `name`, `kind`, `createdAt`, `updatedAt`
- `GET /products/{id}`
- `POST /products`
- `PATCH /products/{id}`
- `DELETE /products/{id}`

- `GET /product-standards`
  - filters: `_id`, `productId`, `workCenterId`, `createdBy`, `validFromFrom`, `validFromTo`, `createdAtFrom`, `createdAtTo`
  - search yok
  - allowed sort: `validFrom`, `idealOutputPerMinute`, `createdAt`, `updatedAt`
- `GET /product-standards/{id}`
- `POST /product-standards`
- `PATCH /product-standards/{id}`
- `DELETE /product-standards/{id}`

### Orders

- `GET /production-plans`
  - filters: `_id`, `code`, `productId`, `createdBy`, `dueAtFrom`, `dueAtTo`, `createdAtFrom`, `createdAtTo`
  - search fields: `code`, `description`
  - allowed sort: `code`, `targetQuantity`, `dueAt`, `createdAt`, `updatedAt`
- `GET /production-plans/{id}`
- `POST /production-plans`
- `PATCH /production-plans/{id}`
- `DELETE /production-plans/{id}`

- `GET /job-orders`
  - tekil filtreler:
    `_id`, `code`, `productionPlanId`, `workCenterId`, `productId`, `createdBy`, `startedBy`, `endedBy`, `runtimeState`
  - çoklu filtreler:
    `workCenterIds`, `productIds`
  - tarih aralıkları:
    `createdAtFrom`, `createdAtTo`
    `plannedStartAtFrom`, `plannedStartAtTo`
    `startTimeFrom`, `startTimeTo`
    `endTimeFrom`, `endTimeTo`
    `dueAtFrom`, `dueAtTo`
    `activeFrom`, `activeTo`
  - search fields: `code`, `description`
  - allowed sort: `code`, `targetQuantity`, `plannedStartAt`, `startTime`, `endTime`, `dueAt`, `createdAt`, `updatedAt`
- `GET /job-orders/{id}`
- `POST /job-orders`
- `PATCH /job-orders/{id}`
- `DELETE /job-orders/{id}`
- `POST /job-orders/{id}/start`
  - body: `startTime?: Date`
- `POST /job-orders/{id}/end`
  - body: `endTime?: Date`

`GET /job-orders` query kuralları:

- farklı filtre aileleri `AND` ile birleşir
- `workCenterIds` ve `productIds` comma-separated çoklu değer kabul eder ve `IN` gibi çalışır
- `runtimeState` türetilmiş filtredir:
  - `pending`: `startTime == null`
  - `running`: `startTime != null && endTime == null`
  - `finished`: `startTime != null && endTime != null`
- `activeFrom` ve `activeTo`, yalnız start edilmiş iş emirleri için execution interval kesişimi kontrol eder
- execution interval tanımı:
  `[startTime, endTime || +inf)`
- `activeFrom` ve `activeTo` birlikte verilirse, execution interval ile istenen zaman penceresi kesişmelidir
- yalnız `activeFrom` verilirse, execution interval `activeFrom` anından sonra da devam ediyor olmalıdır
- yalnız `activeTo` verilirse, execution interval `activeTo` anından önce başlamış olmalıdır

### Operational Adjustments

- `GET /quantity-adjustments`
  - filters: `_id`, `jobOrderId`, `workCenterId`, `productId`, `shiftId`, `createdBy`, `timeFrom`, `timeTo`, `createdAtFrom`, `createdAtTo`
  - search fields: `reason`, `description`
  - allowed sort: `time`, `amount`, `createdAt`, `updatedAt`
- `GET /quantity-adjustments/{id}`
- `POST /quantity-adjustments`
- `PATCH /quantity-adjustments/{id}`
- `DELETE /quantity-adjustments/{id}`

- `GET /scrap-entries`
  - filters: `_id`, `jobOrderId`, `workCenterId`, `productId`, `shiftId`, `reasonId`, `createdBy`, `startTimeFrom`, `startTimeTo`, `endTimeFrom`, `endTimeTo`, `createdAtFrom`, `createdAtTo`
  - search fields: `description`
  - allowed sort: `startTime`, `endTime`, `amount`, `createdAt`, `updatedAt`
- `GET /scrap-entries/{id}`
- `POST /scrap-entries`
- `PATCH /scrap-entries/{id}`
- `DELETE /scrap-entries/{id}`

## Visibility

- Public route access requires the relevant module permission.
- `ProductStandard`, `JobOrder`, `QuantityAdjustment`, and `ScrapEntry` are work-center-bound records.
- Public list/get operations for work-center-bound records only return items whose `workCenterId` is in the caller's `workCenterIds`.
- Public create, update, delete, start, and end operations for work-center-bound records are allowed only when the target `workCenterId` is in the caller's `workCenterIds`.
- `Uom`, `ProductCategory`, `Product`, and `ProductionPlan` use permission-only visibility.
- Internal routes use the system-bypass convention. Service-to-service internal endpoints,
  including Performance OEE batch endpoints, run with system identity and must not apply
  end-user `workCenterIds` filtering. Public controllers must still enforce
  `req.user.workCenterIds` before create/update/delete mutations.

## Permissions

Public route erişimi ilgili modül permission'ı gerektirir.

| Module | Permissions |
|--------|-------------|
| Catalog (`Uom`, `ProductCategory`, `Product`) | `readCatalog`, `writeCatalog`, `deleteCatalog` |
| Standards (`ProductStandard`) | `readProductStandards`, `writeProductStandards`, `deleteProductStandards` |
| `ProductionPlan` | `readProductionPlans`, `writeProductionPlans`, `deleteProductionPlans` |
| `JobOrder` | `readJobOrders`, `writeJobOrders`, `deleteJobOrders`, `executeJobOrders` |
| Adjustments (`QuantityAdjustment`, `ScrapEntry`) | `readProductionAdjustments`, `writeProductionAdjustments`, `deleteProductionAdjustments` |

## Service Contracts

### Work Center -> Production

Amaç: work center silme ve ölçüm konfigürasyonu kilit kontrolü.

Önerilen internal endpoint:

- `GET /internal/v1/work-centers/{id}/references`

Response:

- `inUse: boolean`
- `hasStartedJobOrders: boolean`

Davranış:

- `inUse = true` ise work center delete bloklanır
- `hasStartedJobOrders = true` ise work center ölçüm konfigürasyonu değişikliği bloklanır

### Production -> Work Center

Amaç: work center varlık ve ölçüm modu doğrulaması.

Production-service, `work-center-service` iç API'sinden şu bilgileri okur:

- `type`
- `productivityMode`

Kurallar:

- ilk started `JobOrder` sonrasında work center üretim ölçüm konfigürasyonu değiştirilemez

### Performance -> Production

Amaç: scrap reason ownership boundary.

Kurallar:

- `grossProduction` owner'ı `operations-service`tir
- `ScrapEntry.reasonId` opsiyonel external referanstır
- `reasonId` master data owner'ı `performance-service` Reason kataloğudur
- `reasonId` verilirse Performance Reason `usages` içinde `scrap` olmalıdır
- `reasonId` yoksa Performance OEE quality hesabında scrap OEE-affecting kabul edilir
- Production create/update path'leri mümkün olduğunda `reasonId` için Performance internal
  validation kullanmalıdır; Performance OEE hesaplaması yine defensive davranmalı ve
  bilinmeyen/missing reason'ı OEE-affecting saymalıdır
- `shiftId` references `work-center-service.Shift` — production must validate shift existence via `GET /internal/v1/shifts/:id` on write paths (create/update).
- **Delete guard:** Production exposes `GET /internal/v1/shifts/:id/references` so work-center can block shift delete when any `QuantityAdjustment` or `ScrapEntry` references the shift.

### Performance OEE Hot Path -> Production

Amaç: Performance OEE hesaplamasının çok sayıda küçük internal HTTP çağrısı yapmadan
Production verilerini alması.

Bu endpointler Performance OEE için required internal contract'tır. Public collection
list endpointlerinin veya tekil service/controller fonksiyonlarının loop içinde
çağrılması bu contract'ın yerine geçmez. Implementation bulk Mongo query, grouping ve
projection/minimal response shape kullanmalıdır. TypeScript tarafında bu shape'ler `type`
veya schema-inferred type olarak modellenmeli; mevcut modül convention'ı yoksa Java-style
`dto` dosyaları oluşturulmamalıdır.

#### Product Standard Timeline Batch

```http
POST /internal/v1/product-standards/timelines:batch
```

Request:

```ts
{
  items: Array<{
    jobOrderId: string
    workCenterId: string
    productId: string
    from: string
    to: string
  }>
}
```

Response:

```ts
{
  items: Array<{
    jobOrderId: string
    standards: ProductStandard[]
    qualityFlags: string[]
  }>
}
```

Davranış, tekil timeline endpoint'iyle aynı standard seçim semantiğini korur: `from`
anında geçerli baseline standard ve aralık içindeki sonraki revision'lar dönmelidir.

#### Job Order Records Batch

```http
POST /internal/v1/job-order-records:batch
```

Request:

```ts
{
  items: Array<{
    jobOrderId: string
    from: string
    to: string
  }>
  include: Array<'quantity_adjustments' | 'scrap_entries'>
}
```

Response:

```ts
{
  quantityAdjustmentsByJobOrderId: Record<string, QuantityAdjustment[]>
  scrapEntriesByJobOrderId: Record<string, ScrapEntry[]>
}
```

Bu endpoint tek job order için de çoklu job order için de aynı şekilde kullanılmalıdır.
Performance tarafında tekil/çoklu ayrımıyla farklı endpointlere dallanma yapılmamalıdır.
Response yalnız OEE'nin ihtiyaç duyduğu alanları içermelidir; gereksiz Mongo alanları
yüklenmemeli ve serialize edilmemelidir.

## Cross-Cutting Rules

- Default value policy:
  optional scalar/ref fields default to `null`, array fields default to `[]`, and `props` fields default to `{}`
- `ProductStandard.validFrom` defaults to `now` when omitted
- `props` yalnız `Product`, `ProductionPlan`, `JobOrder` ve `ScrapEntry` üstünde bulunur; flat key-value object'tir, nested object/array tutulmaz ve patch sırasında tüm object replace edilir
- External reference'lar owner servis erişilebilir olduğunda validate edilir
- Event publication kuralı: önce persist, sonra publish; publish hatası business write işlemini rollback etmez
- Lifecycle komutları create, patch, delete, start ve end ile sınırlıdır
- **Auth context cache:** `authenticate` middleware tek bir `GET /internal/v1/users/:id/auth-context` call'u ile status, roles, permissions ve workCenterIds'i birleşik `auth:ctx:{userId}` key'inde cache'ler (TTL 5min, shared unprefixed Redis client). Controller'lar `req.user.workCenterIds` üzerinden visibility scope'u alır.

## Events

Publish on `events.production`: `uom.created`, `uom.updated`, `uom.deleted`, `product_category.created`, `product_category.updated`, `product_category.deleted`, `product.created`, `product.updated`, `product.deleted`, `product_standard.created`, `product_standard.updated`, `product_standard.deleted`, `production_plan.created`, `production_plan.updated`, `production_plan.deleted`, `job_order.created`, `job_order.updated`, `job_order.started`, `job_order.ended`, `job_order.deleted`, `quantity_adjustment.created`, `quantity_adjustment.updated`, `quantity_adjustment.deleted`, `scrap_entry.created`, `scrap_entry.updated`, `scrap_entry.deleted`.

Every event includes `eventId`, `type`, `occurredAt`, `traceId`, and relevant ids.

## External Dependencies

- `work-center-service`: `WorkCenter` varlığı, fiziksel/virtual ayrımı ve `productivityMode`
- `operations-service`: `grossProduction` owner'ı
- `performance-service`: `ScrapEntry.reasonId` için reason master data owner'ı
- `user-service` / auth context: public route authentication, permission çözümü ve `createdBy` / `startedBy` / `endedBy` actor kimliği
- `work-center-service` (shift module): `shiftId` kimliği ve shift definition owner'ı

## Delete And Reference Rules

- `Uom` delete:
  yalnız hiçbir `Product.uomId` referansı yoksa yapılabilir
- `ProductCategory` delete:
  yalnız hiçbir `Product.categoryId` referansı yoksa yapılabilir
- `Product` delete:
  `ProductStandard`, `ProductionPlan`, `JobOrder`, `QuantityAdjustment`, `ScrapEntry` referansı yoksa yapılabilir
- `ProductStandard` delete:
  uygulanmış değilse yapılabilir; tek kalan revision ise yalnız o `productId + workCenterId` için hiçbir `JobOrder` yoksa silinebilir (JobOrder varsa önce ilgili JobOrder'lar silinmelidir)
- `ScrapEntry` delete:
  yapılabilir
- `ProductionPlan` delete:
  child `JobOrder` yoksa yapılabilir
- `JobOrder` delete:
  start edilmemişse ve `QuantityAdjustment` / `ScrapEntry` referansı yoksa yapılabilir
- `QuantityAdjustment` delete:
  yapılabilir

## Assumptions

- `ProductionPlan` opsiyoneldir; standalone `JobOrder` birinci sınıf kullanım şeklidir
- `shiftId` ownership'i `work-center-service` shift module tarafındadır
- Work center archive lifecycle'ı production tarafında modellenmez; production yalnız referans ve fiziksel work center doğrulamasına dayanır
- Bu spec service boundary ve behavior contract'ını tanımlar; execution hesapları `operations-service` owner'lığında kalır
