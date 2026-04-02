# Telemetry Service Design

**Date:** 2026-04-01
**Status:** Draft
**Scope:** Service design for field signal management, MQTT ingestion, historian storage, and tag-based calculations.

## 1. Service Purpose

- Saha sinyallerinin tanimini, kaynaga baglanmasini, historian kayitlarini, canli deger sorgularini ve diger servislerin kullanacagi guvenilir tag hesaplarini yonetir.
- Hem canli veri akisini hem de gecmise donuk analitik sorgulari destekler.
- OEE ve operator ekranlari icin gerekli tag tabanli hesaplara guvenilir veri saglar.
- OEE/productivity hesaplamalari bu serviste **yapilmaz** — ayri bir productivity servisine aittir.

## 2. Core Domain Concepts

- `EdgeDevice`: Saha agindaki bir Node-RED instance'ini temsil eder. Isim, IP, aciklama ve durum bilgisi tasir. Admin tarafindan kaydedilir.
- `Node`: Ayri bir entity degil — tag binding'deki `nodeId` string'idir. Kullanilabilir node listesi MQTT discovery'den in-memory cache'e alinir ve API uzerinden sunulur.
- `TagType`: Tekrar kullanilabilen ortak tag metadata sablonudur. unit, displayColor ve manualEntryMode gibi alanlar icerir.
- `Tag`: Gercek saha sinyalidir. Adi, davranisi, bagli oldugu node, hassasiyet, retention ve historian politikasi burada tanimlanir.
- `Binding`: Tag'in hangi MQTT kaynagina baglandigini tanimlar. `deviceKey` (EdgeDevice'in external MQTT kimlik anahtari) ve opsiyonel `nodeId` icerir. Binding'siz tag'ler REST uzerinden deger alir.
- `HistorianSample`: Tarihsel olcum kaydidir. Per-tag collection'da saklanir.
- `CurrentState`: History tutulmayan tag'ler icin son durum kaydidir. Shared collection'da saklanir.

## 3. Supported Tag Behaviors

Her tag tam olarak bir davranis tipine sahiptir:

- `counter`: Kumulatif artan sayac tipi sinyal.
- `speed`: Zamana bagli anlik hiz/debi tipi sinyal.
- `binary`: 0/1, on/off, run/stop, active/inactive tipi sinyal.

Davranis tipi, historian semasini, hesap algoritmasini ve sorgu kurallarini belirler.

## 4. Storage Model

- Her `history` mode tag icin **per-tag historian collection** kullanilir. Collection isimlendirmesi: `tag_samples_{tagId}`. 500 makine x 10 yil olceginde surdurulebilir — her collection bagimsiz boyutta kalir, retention/backup granüler yapilabilir.
- `stateOnly` tag'ler icin shared `current_states` collection kullanilir.
- Tag storage mode acikca tanimlanir:
  - `history`: Historian kaydi tutulur.
  - `stateOnly`: Sadece son deger tutulur.

## 5. Tag Definition Fields

Her tag en az su alanlari tasir:

- `id`
- `name`
- `desc`
- `tagTypeId`
- `behavior` (counter | speed | binary)
- `storageMode` (history | stateOnly)
- `digit` (rounding hassasiyeti, sadece counter/speed)
- `tolerance` (minimum degisim esigi, sadece counter/speed)
- `min` / `max` (sadece counter/speed)
- `writable` (cihaza yazma komutu gonderilip gonderilemeyecegi, default false)
- `showOnGraph`
- `retentionPolicy`
- `binding` ({ deviceKey, nodeId? }) — deviceKey = EdgeDevice.deviceKey, nodeId opsiyonel
- `props` (serbest metadata)

## 6. Historian Sample Schema

Ingestion pipeline'a giren payload (MQTT veya REST farketmez) basittir: `{ time, value }`. Servis, predecessor bilgisini in-memory cache'ten turetip sample'a ekler.

Ingestion zamani ayri bir field olarak saklanmaz — MongoDB ObjectId'nin embedded timestamp'i (`_id.getTimestamp()`) bu bilgiyi bedavaya verir.

### Counter Sample

```
occurredAt        — olay zamani (MQTT time)
value             — mevcut deger
prevValue         — bir onceki deger
prevTs            — bir onceki degerin zamani
prev2Value        — iki onceki deger
prev2Ts           — iki onceki degerin zamani
reset             — boolean, counter reset tespit edildiyse true
```

### Speed Sample

```
occurredAt        — olay zamani (MQTT time)
value             — mevcut deger
prevValue         — bir onceki deger
prevTs            — bir onceki degerin zamani
```

Speed icin `prev2` gereksiz — peak/reset mantigi yok, sadece stepwise-hold hesabi yapilir.

### Binary Sample

```
occurredAt        — olay zamani (MQTT time)
value             — mevcut deger (0 veya 1)
prevValue         — bir onceki deger
prevTs            — bir onceki degerin zamani
```

Binary icin `prev2` gereksiz — sadece durum degisimi (0→1 veya 1→0) kayda alinir.

### Ilk Sample

Bir tag'in ilk sample'inda predecessor yoktur. `prevValue`, `prevTs` (ve counter icin `prev2Value`, `prev2Ts`) **null** olur. Counter icin ilk sample'da `reset: false`.

## 7. Ingestion Rules

### Predecessor Cache

- Servis, her aktif tag icin son persisted sample'i **in-process memory**'de tutar (Redis degil).
- Cache lazy-loaded: ilk MQTT mesaji geldiginde tag icin cache miss olursa DB'den cekilir.
- Yeni sample persist edildikten sonra cache guncellenir.
- Cache yapisi: `Map<tagId, { value, occurredAt, prevValue, prevTs, prev2Value?, prev2Ts? }>`
- `prev2Value` ve `prev2Ts` yalnizca counter tag'ler icin tutulur (peak detection icin gerekli).
- Tek instance servis — in-process cache yeterli, external cache invalidation karmasikligi yok.

### Binding Lookup Cache

- MQTT subscriber her mesajda `deviceKey + nodeId` → `Tag` eslesmesi yapar. Bu lookup saniyede yuzlerce kez olacagi icin in-process cache gerekir.
- Cache yapisi: `Map<"deviceKey:nodeId", Tag>`
- Tag CRUD islemlerinde (create/update/delete binding) cache senkron guncellenir.
- Eslesmesi olmayan mesajlar sessizce drop edilir (log yazilmaz — yuksek throughput'ta log spam'i onlenir).

### Out-of-Order and Duplicate Handling

- Gelen mesajin `time` degeri, cache'teki son `occurredAt` degerinden buyuk olmalidir (`message.time > cache.occurredAt`).
- Esit veya kucuk olan mesajlar out-of-order veya duplicate kabul edilir ve drop edilir.
- v1'de out-of-order mesajlar icin backfill veya predecessor zinciri yeniden kurma yapilmaz.
- Tum tag tiplerinde payload `time` kullanilir — server receivedTime ile karistirilmaz.

### Filtering Rules

- Tum tag tiplerinde ardisik ayni deger historian'a tekrar yazilmaz (dedup).
- Numeric tag'lerde `digit` rounding uygulanir.
- Numeric tag'lerde `tolerance` altindaki degisimler historian'a yazilmaz.
- `binary` tag yalnizca durum degistiginde historian'a yazilir.
- `stateOnly` tag historian'a append etmez; shared current-state kaydini overwrite eder.

### Counter Reset Detection

- Reset tespiti 1-sample gecikmeli peak detection ile yapilir.
- Peak formula (mevcut sample yazilirken):
  ```
  prev2 = prev2Value
  prev1 = prevValue
  curr  = value
  peak = (prev2 > curr > prev1) OR (prev2 > prev1 > curr)
  ```
- Peak tespit edildiginde, o sample'a `reset: true` yazilir.
- Bu yaklasim tek bir hatali okuma (glitch) ile gercek reset'i dogal olarak ayirir:
  - `100, 101, 50, 102` → peak=false (50 glitch'ti, 102 ile normal devam)
  - `100, 101, 50, 51` → peak=true (101 gercek peak, reset sonrasi sayac yeniden baslamis)
- v1'de 0'a reset zorunlulugu veya rollover size kontrolu yoktur. Ileride iyilestirilebilir.

## 8. Query Capabilities

### Endpoints

| Endpoint | Amac | Onceki deger davranisi |
|---|---|---|
| `GET /historian/:tagId/compact-values` | Compact timeline `[{ t, v }]` | Her zaman prepend (stateful timeline) |
| `GET /historian/:tagId/samples` | Ham range sorgusu (paginated) | Opsiyonel: `?previous=true` |
| `GET /historian/:tagId/count` | Aralik icindeki sample sayisi | Yok |
| `GET /historian/:tagId/stats` | min, max, mean, variance, stddev | Yok |
| `GET /historian/:tagId/produced` | Reset-aware kumulatif hesap | Hesapta kullanilir, response'a eklenmez |
| `GET /historian/:tagId/speed-avg` | Stepwise-hold agirlikli ort. | Hesapta kullanilir, response'a eklenmez |
| `GET /historian/:tagId/state-durations` | Durum gecis timeline'i | Hesapta kullanilir (initial state), ayri item dondurulmez |
| `GET /historian/:tagId/rollup` | Bucketed time-series | Carry-forward icin kullanilir, ayri item dondurulmez |

Tum range endpoint'leri `from` ve `to` query parametreleri alir. Rollup ek olarak `interval` (bucket boyutu, orn: `5m`, `1h`) ve `fn` (aggregation fonksiyonu) alir.

### Onceki Deger Kurali

Timeline veren endpoint'ler (compact-values, samples w/ opt-in) range baslangicinin oncesindeki son sample'i response'a prepend eder. Grafik cizerken veya dis servislerden cagrildiginda baslangic state'i dogrudan response'ta olur — ayrica sorgu gerekmez.

Hesap yapan endpoint'ler (produced, speed-avg, state-durations) onceki degeri icsel olarak kullanir ama response'a ayri item olarak eklemez. Rollup endpoint'i onceki degeri bos bucket'larda carry-forward icin kullanir.

### Diger Kurallar

- Desteklenen rollup fonksiyonlari (`fn`): `average`, `last`, `first`, `sum`, `min`, `max`.
- Bos bucket'larda carry-forward: son bilinen deger kurali uygulanir.

## 9. Counter Calculation Rules

Counter uretim hesabi reset-aware cumulative mantikla yapilir.

### Formula

```
produced = normal_delta + sum(valid_peak.prev2Value)
```

**normal_delta:**
```
if firstDoc != lastDoc:
  normal_delta = max(lastDoc.value, lastDoc.prevValue) - firstDoc.prevValue
else:
  normal_delta = firstDoc.value - firstDoc.prevValue
```

### Temel Kurallar

- Range baslangicinin oncesindeki son deger opening baseline olarak kabul edilir.
- Reset olan araliklarda pre-reset yuksek degerler (peak'ler) uretim hesabina telafi olarak eklenir.
- Peak'ler: `reset: true` olan sample'larin `prev2Value` degeri toplanir.

### Ornekler

**Ornek 1 — Reset yok:**
```
Degerler: 09:59=100, 10:05=120, 10:10=130
Aralik: 10:00 - 10:10
openingBaseline = 100
closingValue = 130
Reset yok
produced = 130 - 100 = 30
```

**Ornek 2 — Tek reset:**
```
Degerler: 09:59=100, 10:05=120, 10:06=0, 10:10=5
Aralik: 10:00 - 10:10
openingBaseline = 100
closingValue = 5
Peak (reset oncesi): 120
produced = (5 - 100) + 120 = 25
```

## 10. Speed Calculation Rules

Speed tag hesaplari stepwise-hold mantikla yapilir.

### Temel Kurallar

- Range baslangicinin oncesindeki son deger bulunur ve ilk segmentte kullanilir.
- Iki sample arasindaki sure boyunca onceki hiz gecerli kabul edilir (step function).
- Range sonuna kadar son bilinen hiz tasinir.
- Uretim hesabi segment bazli `deger x sure` toplami uzerinden yapilir.
- Speed icin reset/peak mantigi yoktur.

### Ornek

```
Degerler: 10:00:01=120, 10:00:07=90, 10:00:15=80
Aralik: 10:00:03 - 10:00:19

Segmentler:
  120 x 4sn (10:00:03 → 10:00:07)
  90 x 8sn  (10:00:07 → 10:00:15)
  80 x 4sn  (10:00:15 → 10:00:19)

totalArea = 480 + 720 + 320 = 1520
weighted avg speed = 1520 / 16sn = 95
```

## 11. Binary Calculation Rules

- `binary` historian transition history tutar.
- Sadece durum degistiginde kayit yazilir (0→1 veya 1→0).
- Current state son transition kaydindan bulunur.
- Timeline ve state duration sorgulari transition history uzerinden hesaplanir.
- Binary icin cumulative veya peak mantigi yoktur.

## 12. Historian Integrity Rules

- Period closure lock oncesindeki historian verisi degistirilemez.
- Period closure enforcement: Ingestion pipeline (hem MQTT hem REST write path), sample'in `time` degeri locked period icindeyse yazimi reddeder. Lock state, period closure event'leri uzerinden (`events.production` veya ilgili stream) consume edilir ve in-memory tutulur.
- Historian iceren tag'lerde silme islemi historian butunlugunu bozmayacak sekilde yonetilmelidir.
- Tag behavior, veri toplama basladiktan sonra fiilen sabit kabul edilmelidir.
- Ayni tag icin binding degisse bile gecmis historian kimligi bozulmamalidir.

## 13. Retention and Export

- Retention policy tag bazinda tanimlanir.
- Per-tag collection yapisi sayesinde retention = eski collection verisini temizlemek veya collection'i drop etmek.
- Export islemleri buyuk veri hacminde stream yaklasimi ile calisir (v2).

## 14. EdgeDevice & Node Management

### EdgeDevice

- Saha agindaki bir Node-RED instance'ini temsil eder.
- **Authoritative olarak admin tarafindan olusturulur** — MQTT discovery EdgeDevice auto-create etmez.
- Alanlar: isim, IP adresi, aciklama, durum, `deviceKey`.
- `deviceKey`: Unique, immutable, slug-format external identifier. MQTT topic'lerinde ve binding'lerde EdgeDevice'i tanimlamak icin kullanilir. Format: `^[a-z0-9][a-z0-9-]*[a-z0-9]$` (ornek: `press-line-1`, `cnc-03`). Olusturulduktan sonra degistirilemez.
- MQTT uzerinden online/offline durumu izlenir (LWT). LWT status degisiklikleri EdgeDevice kaydinda `status` alanina persist edilir (sadece in-memory degil).
- Node-RED'in kendi web UI'ina erisim icin IP bilgisi sunulur.
- `createdBy`, `updatedBy`, `createdAt`, `updatedAt` standart audit alanlari.

### Node & Binding

- Node ayri bir entity/collection degildir. Tag binding'deki `nodeId` string'i ile temsil edilir.
- Kullanilabilir node listesi MQTT discovery'den in-memory cache'e alinir ve API uzerinden sunulur. DB'ye yazilmaz.
- Frontend'de tag tanimlarken "hangi device'in hangi node'una bagla" listesi bu cache'ten gelir.
- Bir tag en fazla bir source node'a baglanir (1:1). Bir source node en fazla bir tag tarafindan bind edilebilir.
- Binding zorunlu degildir — `nodeId` bos olabilir. Ornegin fiziksel sensoru olmayan bir makinenin run tag'i, harici bir script tarafindan deger yazilarak yonetilir (uretim suresi asildiysa run=0 set edilir vs.).

### MQTT Discovery

| Topic | Amac | Yon |
|-------|------|-----|
| `discovery/{deviceKey}/manifest` | Device ve node listesi (retained) | Subscribe |
| `discovery/{deviceKey}/status` | Online/offline (LWT ile otomatik) | Subscribe |

Node-RED startup'ta manifest publish eder, graceful shutdown veya baglanti kopmasinda LWT ile offline status yayinlanir. Discovery verileri UI'da gosterilir ancak otomatik entity olusturmaz.

## 15. MQTT Telemetry Contract

| Topic | Amac | Yon |
|-------|------|-----|
| `devices/{deviceKey}/nodes/{nodeId}` | Ham tag verileri | Subscribe |

**Payload:**
```json
{ "time": "2026-04-01T10:00:00.000Z", "value": 421 }
```

Servis `devices/+/nodes/+` wildcard subscribe yapar. Gelen mesajdaki `deviceKey + nodeId` ile eslesen tag'i binding lookup cache'ten bulur ve ingestion pipeline'a sokar. Eslesmesi olmayan mesajlar sessizce drop edilir.

### MQTT Connection Requirements

- Servis kisa baglanti kesintilerinde veri kaybetmemeyi hedeflemelidir (persistent session).
- Broker baglanti durumu gozlemlenebilir olmalidir (LWT ile offline/online status).
- Akis kontrolu / back-pressure desteklenmelidir (broker'in gonderdigi unacknowledged mesaj sayisi sinirlandirilmalidir).
- Out-of-order mesajlar drop edilir (Section 7'de detaylandirilmistir).

## 16. Tag Value Write Paths

### A) REST Value Write (Virtual / Unbound Tag'ler)

- Endpoint: `POST /tags/:id/values` — `{ time, value }` payload.
- Binding'i olmayan (nodeId bos) tag'lere deger yazmak icin kullanilir. Script'ler, dis sistemler veya operator islemleri bu yolu kullanir.
- Ayni ingestion kurallari uygulanir: `time > son kayit`, dedup, rounding, tolerance (counter ve speed, default 0).
- Historian'a yazar, predecessor cache gunceller, Redis Pub/Sub ile yayinlar.
- MQTT'den gelen veriyle ayni pipeline'a girer, sadece giris noktasi farklidir.

### B) Device Write Command (Fiziksel Cihaza Komut)

- Endpoint: `POST /tags/:id/command` — `{ value }` payload.
- Validasyon: tag var mi, `writable: true` mi, value tipi uygun mu (number | boolean). Ingestion seviyesinde validasyon yapilmaz.
- Tag'in binding'indeki `deviceKey` uzerinden `EdgeDevice.findOne({ deviceKey })` ile IP adresi alinir.
- Node-RED uzerindeki HTTP endpoint'e senkron istek atilir (ornek: `POST http://{edgeDeviceIp}:1880/api/nodes/{nodeId}/write`).
- Node-RED gelen istegi OPC-UA/Modbus uzerinden PLC'ye yazar. Basari/hata senkron doner.
- Historian kaydi **burada olusmaz**. Cihaz degeri degistirip normal telemetry yoluyla (`devices/{deviceKey}/nodes/{nodeId}` MQTT topic) publish ederse, standart ingestion pipeline ile kaydedilir.

## 17. Redis Streams Events

### Produces (`events.telemetry` stream)

Config/metadata degisiklikleri (Redis Streams):
- `tag.created`, `tag.updated`, `tag.deleted`
- `tag_type.created`, `tag_type.updated`, `tag_type.deleted`
- `edge_device.created`, `edge_device.updated`, `edge_device.deleted`

### Realtime Value Notifications (Redis Pub/Sub)

- Historian'a yeni sample yazildiktan sonra, processed (dedup/rounding uygulanmis) deger **Redis Pub/Sub** uzerinden best-effort olarak yayinlanir.
- Realtime service bu channel'a subscribe olur ve canli dashboard'lara iletir.
- Redis Pub/Sub fire-and-forget'tir — realtime service down ise mesajlar kaybolur, bu kabul edilebilir (canli ekran icin durability gerekli degil).
- Redis Streams bu amac icin kullanilmaz — throughput cok yuksek, durability gereksiz.
- Channel pattern: `tag:{tagId}:value`

### Realtime Service Socket.io Delivery

- Realtime service Redis Pub/Sub'a subscribe olur ve canli degerleri Socket.io uzerinden frontend'e iletir.
- Tag-based room yapisi kullanilir: client izlemek istedigi tag'lerin `tag:{tagId}` room'larina join olur.
- Redis Pub/Sub'dan `tag:{tagId}:value` mesaji geldiginde, realtime service `io.to("tag:{tagId}").emit(...)` yapar.
- Bu yaklasimda realtime service domain bilgisine ihtiyac duymaz (workCenter→tag mapping bilmez) — sadece relay gorevi gorur.
- Mevcut workCenter-based room'lar CRUD event'leri icin aynen devam eder; telemetry value delivery ayri bir concern'dur.

### Consumes

- Period closure events (belirli bir tarihten onceki veriyi kilitlemek)
- Ihtiyac olustukca diger stream'lerden

## 18. Audit Fields

Tag, TagType ve EdgeDevice entity'lerinde standart audit alanlari bulunur: `createdBy`, `updatedBy`, `createdAt`, `updatedAt`. Historian sample'lara bu alanlar eklenmez (hot-path, gereksiz overhead).

## 19. Non-Functional Requirements

- Historian sorgulari range ve aggregation bazli optimize edilmelidir.
- Sicak yol (canli ekran, sik cagrilan) ve soguk yol (analitik, nadir) ayrilmalidir.
- Canli ekran tekrar eden pahali hesaplar calistirmamalidir.
- Buyuk veri araliklarinda bellek guvenligi korunmalidir (stream yaklaşimi).
- Tum historian hesaplari deterministik ve yeniden uretilebilir olmalidir.

## 20. Edge Tool: Node-RED

- Saha veri toplama icin Node-RED kullanilir (Apache 2.0, tamamen ucretsiz, tag limiti yok).
- Node-RED, PLC/SCADA'dan okur (OPC-UA, Modbus, S7, EtherNet/IP) ve MQTT'ye publish eder.
- Protokol-spesifik konfigürasyon Node-RED'in kendi UI'inda yapilir — bu servis PLC baglanti detaylarini yonetmez.
- Node-RED instance'lari EdgeDevice olarak kaydedilir, node'lari MQTT discovery ile kesfedilir.
- Node-RED, HTTP endpoint (`POST /api/nodes/:nodeId/write`) uzerinden dis sistemlerden gelen yazma komutlarini kabul eder ve PLC'ye iletir.

## 21. Local Dev/Test Setup

Docker Compose'a eklenir (development ortami icin):

- **OPC-UA Simulator**: Counter ve run tag simule eder.
- **Node-RED**: Simulator'dan OPC-UA ile okur, Mosquitto'ya publish eder.
- **Mosquitto**: MQTT broker (zaten mevcut).
- **Telemetry Service**: Subscribe olur, sample yazar.

Gercek PLC olmadan tum pipeline end-to-end test edilebilir.

## 22. v2+ Notlari

- Manual correction / backfill (interval-based, predecessor zinciri yeniden hesaplama)
- Export (buyuk veri, background job)
- Fledge entegrasyonu
- Gelismis reset detection (rollover size, min-value check)
- Out-of-order backfill (gecmise insert + predecessor zinciri yeniden kurma)
